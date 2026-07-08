import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("~/server/util/resolveActor", () => ({
  resolveActor: vi.fn(),
}));

import { resolveActor } from "~/server/util/resolveActor";
import {
  resolveActorMiddleware,
  resolveActorAllowingUnlinked,
} from "~/server/middleware/resolveActorMiddleware";
import { getCurrentActor } from "~/server/util/actorContext";

const mockedResolveActor = vi.mocked(resolveActor);

function makeReq(
  sessionUser?: string,
  headers: Record<string, string> = {},
): Request {
  return {
    session: { user: sessionUser },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveActorMiddleware (strict)", () => {
  it("401s when there is no session user", async () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();
    await resolveActorMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.actor and calls next on success", async () => {
    const actor = {
      loginEmail: "owner@example.com",
      source: "owner" as const,
      accountEmail: "owner@example.com",
      profile: "admin" as const,
      siteIds: "*" as const,
    };
    mockedResolveActor.mockResolvedValue(actor);
    const req = makeReq("owner@example.com");
    const res = makeRes();
    let seenInsideNext: unknown;
    await resolveActorMiddleware(req, res, () => {
      seenInsideNext = getCurrentActor();
    });
    expect(req.actor).toEqual(actor);
    // The AsyncLocalStorage context is populated for the duration of next().
    expect(seenInsideNext).toEqual(actor);
  });

  it("403s on no_access without a bootstrap fallback", async () => {
    mockedResolveActor.mockResolvedValue({ error: "no_access" });
    const req = makeReq("nobody@example.com");
    const res = makeRes();
    const next = vi.fn();
    await resolveActorMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(req.actor).toBeUndefined();
  });

  it("400s on ambiguous", async () => {
    mockedResolveActor.mockResolvedValue({ error: "ambiguous" });
    const req = makeReq("multi@example.com");
    const res = makeRes();
    const next = vi.fn();
    await resolveActorMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s on not_authorized_for_account", async () => {
    mockedResolveActor.mockResolvedValue({
      error: "not_authorized_for_account",
    });
    const req = makeReq("someone@example.com", {
      "x-account-email": "not-mine@example.com",
    });
    const res = makeRes();
    const next = vi.fn();
    await resolveActorMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("passes the X-Account-Email header through to resolveActor", async () => {
    mockedResolveActor.mockResolvedValue({
      loginEmail: "delegate@example.com",
      source: "delegate",
      accountEmail: "account-a@example.com",
      profile: "write",
      siteIds: "*",
    });
    const req = makeReq("delegate@example.com", {
      "x-account-email": "account-a@example.com",
    });
    const res = makeRes();
    await resolveActorMiddleware(req, res, vi.fn());
    expect(mockedResolveActor).toHaveBeenCalledWith(
      "delegate@example.com",
      "account-a@example.com",
    );
  });
});

describe("resolveActorAllowingUnlinked (bootstrap)", () => {
  it("lets a login with no accessible accounts through as a provisional self-owner", async () => {
    mockedResolveActor.mockResolvedValue({ error: "no_access" });
    const req = makeReq("brand-new@example.com");
    const res = makeRes();
    const next = vi.fn();
    await resolveActorAllowingUnlinked(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.actor).toEqual({
      loginEmail: "brand-new@example.com",
      source: "owner",
      accountEmail: "brand-new@example.com",
      profile: "admin",
      siteIds: "*",
    });
  });

  it("still enforces the strict check when an X-Account-Email was explicitly requested", async () => {
    mockedResolveActor.mockResolvedValue({ error: "no_access" });
    const req = makeReq("brand-new@example.com", {
      "x-account-email": "someone-elses@example.com",
    });
    const res = makeRes();
    const next = vi.fn();
    await resolveActorAllowingUnlinked(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("still 400s on ambiguous rather than bootstrapping", async () => {
    mockedResolveActor.mockResolvedValue({ error: "ambiguous" });
    const req = makeReq("multi@example.com");
    const res = makeRes();
    const next = vi.fn();
    await resolveActorAllowingUnlinked(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("behaves identically to the strict variant on success", async () => {
    const actor = {
      loginEmail: "owner@example.com",
      source: "owner" as const,
      accountEmail: "owner@example.com",
      profile: "admin" as const,
      siteIds: "*" as const,
    };
    mockedResolveActor.mockResolvedValue(actor);
    const req = makeReq("owner@example.com");
    const res = makeRes();
    const next = vi.fn();
    await resolveActorAllowingUnlinked(req, res, next);
    expect(req.actor).toEqual(actor);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
