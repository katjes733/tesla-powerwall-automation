import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Actor } from "~/server/util/actor";

// userAdmin.ts's own actor resolution is covered by
// resolveActorMiddleware.test.ts — here we inject a controllable req.actor
// directly so these tests focus purely on the route handlers' own logic
// (self-grant rejection, cross-account scoping, signup-vs-notification
// branching).
let currentActor: Actor | undefined;
vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = currentActor;
    next();
  },
}));

const mockQuery = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: async () => ({ query: mockQuery }) },
  qualifiedTable: (table: string) => `"public".${table}`,
}));

const mockGenerateAndSendCode = vi.fn();
vi.mock("~/server/routes/signupVerification", () => ({
  generateAndSendCode: (...args: unknown[]) => mockGenerateAndSendCode(...args),
}));

const mockSendEmail = vi.fn();
vi.mock("~/server/util/mailing", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// Imported dynamically (after resetModules, inside buildApp) rather than
// statically at the top of the file — userAdmin.ts calls logger.child() at
// module scope, and a static import would evaluate that before tests/setup.ts's
// beforeEach installs the logger stub, leaking real log output into test runs.
async function buildApp() {
  vi.resetModules();
  const { router } = await import("~/server/routes/userAdmin");
  const app = express();
  app.use(express.json());
  app.use("/api/user-admin", router);
  return app;
}

function adminActor(overrides: Partial<Actor> = {}): Actor {
  return {
    loginEmail: "owner@example.com",
    source: "owner",
    accountEmail: "owner@example.com",
    profile: "admin",
    siteIds: "*",
    ...overrides,
  };
}

beforeEach(() => {
  // clearAllMocks (not resetAllMocks) — resetAllMocks would also wipe out
  // tests/setup.ts's global logger.child spy (installed in its own beforeEach,
  // which runs before this one), reverting it to a real call-through pino
  // logger and leaking log output into test runs. Every test here queues its
  // own mockResolvedValueOnce values, so clearing call history is sufficient.
  vi.clearAllMocks();
  currentActor = adminActor();
});

describe("GET /delegates", () => {
  it("403s for a non-admin actor", async () => {
    currentActor = adminActor({ profile: "write" });
    const app = await buildApp();
    const res = await request(app).get("/api/user-admin/delegates");
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns only the calling account's active grants, flattened", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "delegate-a@example.com",
        user_permissions: {
          delegations: [
            {
              tesla_account_email: "owner@example.com",
              profile: "write",
              site_ids: "*",
              status: "active",
            },
            // A grant for a *different* account that happens to live in the
            // same row must not leak into this account's list.
            {
              tesla_account_email: "someone-elses@example.com",
              profile: "admin",
              site_ids: "*",
              status: "active",
            },
          ],
        },
      },
    ]);
    const app = await buildApp();
    const res = await request(app).get("/api/user-admin/delegates");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        delegate_email: "delegate-a@example.com",
        tesla_account_email: "owner@example.com",
        profile: "write",
        site_ids: "*",
        status: "active",
      },
    ]);
  });

  it("excludes revoked grants for the account", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "delegate-a@example.com",
        user_permissions: {
          delegations: [
            {
              tesla_account_email: "owner@example.com",
              profile: "write",
              site_ids: "*",
              status: "revoked",
            },
          ],
        },
      },
    ]);
    const app = await buildApp();
    const res = await request(app).get("/api/user-admin/delegates");
    expect(res.body.data).toEqual([]);
  });
});

describe("POST /delegates/invite", () => {
  const validBody = {
    delegate_email: "new-delegate@example.com",
    profile: "write",
    site_ids: "*",
  };

  it("403s for a non-admin actor", async () => {
    currentActor = adminActor({ profile: "write" });
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/invite")
      .send(validBody);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("400s when inviting the account's own owner email", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/invite")
      .send({ ...validBody, delegate_email: "owner@example.com" });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("409s when an active grant for this delegate/account pair already exists", async () => {
    mockQuery.mockResolvedValueOnce([{ "?column?": 1 }]); // existingActive check
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/invite")
      .send(validBody);
    expect(res.status).toBe(409);
    // Only the existence check ran — no insert/append/lookup afterward.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("sends a verification code (not a plain notification) for a brand-new delegate", async () => {
    mockQuery
      .mockResolvedValueOnce([]) // existingActive check: none
      .mockResolvedValueOnce(undefined) // placeholder insert
      .mockResolvedValueOnce(undefined) // append grant
      .mockResolvedValueOnce([{ password_hash: "" }]); // hasCompletedSignup: false

    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/invite")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(mockGenerateAndSendCode).toHaveBeenCalledTimes(1);
    expect(mockGenerateAndSendCode.mock.calls[0][0]).toBe(
      "new-delegate@example.com",
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.body.data).toMatchObject({
      tesla_account_email: "owner@example.com",
      profile: "write",
      site_ids: "*",
      status: "active",
      granted_by: "owner@example.com",
    });
  });

  it("sends a plain notification (not a verification code) for an already-signed-up delegate", async () => {
    mockQuery
      .mockResolvedValueOnce([]) // existingActive check: none
      .mockResolvedValueOnce(undefined) // placeholder insert (no-op, row exists)
      .mockResolvedValueOnce(undefined) // append grant
      .mockResolvedValueOnce([{ password_hash: "already-hashed" }]); // hasCompletedSignup: true

    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/invite")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockGenerateAndSendCode).not.toHaveBeenCalled();
  });

  it("scopes the new grant to the calling actor's own account, not an arbitrary one", async () => {
    currentActor = adminActor({ accountEmail: "owner-b@example.com" });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ password_hash: "" }]);

    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/invite")
      .send(validBody);

    expect(res.body.data.tesla_account_email).toBe("owner-b@example.com");
    // The existing-active-grant containment check must be scoped to this
    // account, not any account the delegate might already have a grant for.
    const existingActiveCall = mockQuery.mock.calls[0];
    expect(existingActiveCall[1][1]).toContain("owner-b@example.com");
  });
});

describe("POST /delegates/update", () => {
  const validBody = {
    delegate_email: "delegate-a@example.com",
    profile: "read",
    site_ids: ["site-1"],
  };

  it("403s for a non-admin actor", async () => {
    currentActor = adminActor({ profile: "write" });
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/update")
      .send(validBody);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("400s when editing the account's own owner email", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/update")
      .send({ ...validBody, delegate_email: "owner@example.com" });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the update query to both the delegate and the calling actor's own account", async () => {
    mockQuery.mockResolvedValueOnce(undefined);
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/update")
      .send(validBody);
    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([
      "delegate-a@example.com",
      "owner@example.com",
      JSON.stringify("read"),
      JSON.stringify(["site-1"]),
    ]);
  });
});

describe("POST /delegates/revoke", () => {
  it("403s for a non-admin actor", async () => {
    currentActor = adminActor({ profile: "write" });
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/revoke")
      .send({ delegate_email: "delegate-a@example.com" });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the revoke query to both the delegate and the calling actor's own account", async () => {
    mockQuery.mockResolvedValueOnce(undefined);
    const app = await buildApp();
    const res = await request(app)
      .post("/api/user-admin/delegates/revoke")
      .send({ delegate_email: "delegate-a@example.com" });
    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["delegate-a@example.com", "owner@example.com"]);
  });
});
