import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/util/routes/refreshToken", () => ({
  getByEmail: vi.fn(),
}));

const mockUserFindOne = vi.fn();
vi.mock("~/server/database/datasource", () => ({
  default: {
    getInstance: async () => ({
      getRepository: () => ({ findOne: mockUserFindOne }),
    }),
  },
}));

import { getByEmail } from "~/server/util/routes/refreshToken";
import {
  listAccessibleAccounts,
  selectActiveAccount,
  resolveActor,
  type AccessibleAccount,
} from "~/server/util/resolveActor";

const mockedGetByEmail = vi.mocked(getByEmail);

function delegationRow(delegations: Array<Record<string, unknown>>): {
  user_permissions: { delegations: unknown[] };
} {
  return { user_permissions: { delegations } };
}

describe("listAccessibleAccounts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUserFindOne.mockResolvedValue(null);
  });

  it("returns the owner entry when a RefreshToken exists and no delegations", async () => {
    mockedGetByEmail.mockResolvedValue({ id: "t1" } as never);
    const accounts = await listAccessibleAccounts("owner@example.com");
    expect(accounts).toEqual([
      {
        accountEmail: "owner@example.com",
        profile: "admin",
        siteIds: "*",
        source: "owner",
      },
    ]);
  });

  it("returns a delegate entry for each active grant on the login's own row", async () => {
    mockedGetByEmail.mockResolvedValue(null);
    mockUserFindOne.mockResolvedValue(
      delegationRow([
        {
          tesla_account_email: "account-a@example.com",
          profile: "write",
          site_ids: ["site-1"],
          status: "active",
        },
      ]),
    );
    const accounts = await listAccessibleAccounts("delegate@example.com");
    expect(accounts).toEqual([
      {
        accountEmail: "account-a@example.com",
        profile: "write",
        siteIds: ["site-1"],
        source: "delegate",
      },
    ]);
  });

  it("returns both an owner entry and delegate entries for the same login", async () => {
    mockedGetByEmail.mockResolvedValue({ id: "t1" } as never);
    mockUserFindOne.mockResolvedValue(
      delegationRow([
        {
          tesla_account_email: "account-b@example.com",
          profile: "read",
          site_ids: "*",
          status: "active",
        },
      ]),
    );
    const accounts = await listAccessibleAccounts("hybrid@example.com");
    expect(accounts).toHaveLength(2);
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountEmail: "hybrid@example.com",
          source: "owner",
        }),
        expect.objectContaining({
          accountEmail: "account-b@example.com",
          source: "delegate",
        }),
      ]),
    );
  });

  it("excludes revoked delegation grants", async () => {
    mockedGetByEmail.mockResolvedValue(null);
    mockUserFindOne.mockResolvedValue(
      delegationRow([
        {
          tesla_account_email: "account-c@example.com",
          profile: "write",
          site_ids: "*",
          status: "revoked",
        },
      ]),
    );
    const accounts = await listAccessibleAccounts("delegate@example.com");
    expect(accounts).toEqual([]);
  });

  it("excludes a self-grant even if one somehow exists (defense in depth)", async () => {
    mockedGetByEmail.mockResolvedValue(null);
    mockUserFindOne.mockResolvedValue(
      delegationRow([
        {
          tesla_account_email: "self@example.com",
          profile: "admin",
          site_ids: "*",
          status: "active",
        },
      ]),
    );
    const accounts = await listAccessibleAccounts("self@example.com");
    expect(accounts).toEqual([]);
  });

  it("returns an empty list for a login with no token and no user row", async () => {
    mockedGetByEmail.mockResolvedValue(null);
    mockUserFindOne.mockResolvedValue(null);
    const accounts = await listAccessibleAccounts("nobody@example.com");
    expect(accounts).toEqual([]);
  });
});

describe("selectActiveAccount", () => {
  const owner: AccessibleAccount = {
    accountEmail: "owner@example.com",
    profile: "admin",
    siteIds: "*",
    source: "owner",
  };
  const delegateA: AccessibleAccount = {
    accountEmail: "account-a@example.com",
    profile: "write",
    siteIds: "*",
    source: "delegate",
  };
  const delegateB: AccessibleAccount = {
    accountEmail: "account-b@example.com",
    profile: "read",
    siteIds: "*",
    source: "delegate",
  };

  it("errors with no_access when there are no accounts", () => {
    expect(selectActiveAccount([])).toEqual({ error: "no_access" });
  });

  it("returns the only account when there is exactly one", () => {
    expect(selectActiveAccount([delegateA])).toEqual(delegateA);
  });

  it("prefers the owner entry when multiple accounts and none requested", () => {
    expect(selectActiveAccount([delegateA, owner])).toEqual(owner);
  });

  it("errors with ambiguous when multiple non-owner accounts and none requested", () => {
    expect(selectActiveAccount([delegateA, delegateB])).toEqual({
      error: "ambiguous",
    });
  });

  it("returns the requested account when it matches", () => {
    expect(
      selectActiveAccount([delegateA, delegateB], "account-b@example.com"),
    ).toEqual(delegateB);
  });

  it("errors with not_authorized_for_account when the requested account isn't accessible", () => {
    expect(
      selectActiveAccount([delegateA], "someone-elses@example.com"),
    ).toEqual({ error: "not_authorized_for_account" });
  });
});

describe("resolveActor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUserFindOne.mockResolvedValue(null);
  });

  it("resolves an owner login to a full admin Actor over their own account", async () => {
    mockedGetByEmail.mockResolvedValue({ id: "t1" } as never);
    const actor = await resolveActor("owner@example.com");
    expect(actor).toEqual({
      loginEmail: "owner@example.com",
      source: "owner",
      accountEmail: "owner@example.com",
      profile: "admin",
      siteIds: "*",
    });
  });

  it("resolves a delegate login to an Actor scoped to the granting account, not their own email", async () => {
    mockedGetByEmail.mockResolvedValue(null);
    mockUserFindOne.mockResolvedValue(
      delegationRow([
        {
          tesla_account_email: "account-a@example.com",
          profile: "write",
          site_ids: ["site-1", "site-2"],
          status: "active",
        },
      ]),
    );
    const actor = await resolveActor("delegate@example.com");
    expect(actor).toEqual({
      loginEmail: "delegate@example.com",
      source: "delegate",
      accountEmail: "account-a@example.com",
      profile: "write",
      siteIds: ["site-1", "site-2"],
    });
  });

  it("returns no_access for a login with nothing accessible", async () => {
    mockedGetByEmail.mockResolvedValue(null);
    const result = await resolveActor("nobody@example.com");
    expect(result).toEqual({ error: "no_access" });
  });
});
