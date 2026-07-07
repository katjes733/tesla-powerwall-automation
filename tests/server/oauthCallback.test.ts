import { describe, it, expect, vi } from "vitest";
import {
  validateOAuthState,
  exchangeAndSaveToken,
  buildTeslaAuthorizeUrl,
  type OAuthState,
} from "~/server/util/oauthCallback";

function makeStored(overrides: Partial<OAuthState> = {}): OAuthState {
  return {
    value: "abc-state",
    email: "user@example.com",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("validateOAuthState", () => {
  it("fails with missing_params when code is missing", () => {
    expect(
      validateOAuthState({ state: "abc-state" }, makeStored(), Date.now()),
    ).toEqual({ ok: false, code: "missing_params" });
  });

  it("fails with missing_params when state is missing", () => {
    expect(
      validateOAuthState({ code: "code123" }, makeStored(), Date.now()),
    ).toEqual({ ok: false, code: "missing_params" });
  });

  it("fails with session_expired when nothing is stored", () => {
    expect(
      validateOAuthState(
        { code: "code123", state: "abc-state" },
        undefined,
        Date.now(),
      ),
    ).toEqual({ ok: false, code: "session_expired" });
  });

  it("fails with invalid_state when the state does not match", () => {
    expect(
      validateOAuthState(
        { code: "code123", state: "wrong-state" },
        makeStored(),
        Date.now(),
      ),
    ).toEqual({ ok: false, code: "invalid_state" });
  });

  it("fails with expired when the stored state's TTL has passed", () => {
    const stored = makeStored({ expiresAt: Date.now() - 1000 });
    expect(
      validateOAuthState(
        { code: "code123", state: stored.value },
        stored,
        Date.now(),
      ),
    ).toEqual({ ok: false, code: "expired" });
  });

  it("succeeds and returns the stored email when everything matches", () => {
    const stored = makeStored();
    expect(
      validateOAuthState(
        { code: "code123", state: stored.value },
        stored,
        Date.now(),
      ),
    ).toEqual({ ok: true, email: stored.email });
  });
});

describe("exchangeAndSaveToken", () => {
  const baseOpts = {
    code: "code123",
    redirectUri: "https://example.com/callback",
    email: "user@example.com",
  };

  it("returns exchange_failed when the token endpoint responds not-ok", async () => {
    const getToken = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "invalid_grant",
    } as unknown as Response);
    const saveToken = vi.fn();
    const onError = vi.fn();

    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken,
      saveToken,
      onError,
    });

    expect(result).toEqual({ ok: false, code: "exchange_failed" });
    expect(saveToken).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("exchange_failed", "invalid_grant");
  });

  it("returns exchange_failed when the token request throws", async () => {
    const getToken = vi.fn().mockRejectedValue(new Error("network down"));
    const saveToken = vi.fn();
    const onError = vi.fn();

    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken,
      saveToken,
      onError,
    });

    expect(result).toEqual({ ok: false, code: "exchange_failed" });
    expect(saveToken).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("exchange_failed", expect.any(Error));
  });

  it("returns save_failed when persisting the token throws", async () => {
    const getToken = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ refresh_token: "new-refresh-token" }),
    } as unknown as Response);
    const saveToken = vi.fn().mockRejectedValue(new Error("db down"));
    const onError = vi.fn();

    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken,
      saveToken,
      onError,
    });

    expect(result).toEqual({ ok: false, code: "save_failed" });
    expect(onError).toHaveBeenCalledWith("save_failed", expect.any(Error));
  });

  it("returns ok and saves the refresh token on success", async () => {
    const getToken = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ refresh_token: "new-refresh-token" }),
    } as unknown as Response);
    const saveToken = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken,
      saveToken,
      onError,
    });

    expect(result).toEqual({ ok: true });
    expect(getToken).toHaveBeenCalledWith(baseOpts.code, baseOpts.redirectUri);
    expect(saveToken).toHaveBeenCalledWith({
      email: baseOpts.email,
      refreshToken: "new-refresh-token",
    });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("buildTeslaAuthorizeUrl", () => {
  it("builds an authorize URL with all expected query params", () => {
    const url = buildTeslaAuthorizeUrl({
      clientId: "client-123",
      baseAuthUrl: "https://fleet-auth.example.com",
      redirectUri: "https://tpa.example.com/callback",
      state: "state-abc",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://fleet-auth.example.com");
    expect(parsed.pathname).toBe("/oauth2/v3/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://tpa.example.com/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("state-abc");
    expect(parsed.searchParams.get("scope")).toBe(
      "openid offline_access user_data energy_device_data energy_cmds",
    );
  });
});
