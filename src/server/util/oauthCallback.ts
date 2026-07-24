import type { TokenData } from "~/server/types/common";

export interface OAuthState {
  value: string;
  email: string;
  expiresAt: number;
}

export type OAuthValidationError =
  "missing_params" | "session_expired" | "invalid_state" | "expired";

export type OAuthValidationResult =
  { ok: true; email: string } | { ok: false; code: OAuthValidationError };

export function validateOAuthState(
  query: { code?: string; state?: string },
  stored: OAuthState | undefined,
  now: number,
): OAuthValidationResult {
  if (!query.code || !query.state) {
    return { ok: false, code: "missing_params" };
  }
  if (!stored) {
    return { ok: false, code: "session_expired" };
  }
  if (stored.value !== query.state) {
    return { ok: false, code: "invalid_state" };
  }
  if (stored.expiresAt < now) {
    return { ok: false, code: "expired" };
  }
  return { ok: true, email: stored.email };
}

export type OAuthExchangeError = "exchange_failed" | "save_failed";

export type OAuthExchangeResult =
  { ok: true } | { ok: false; code: OAuthExchangeError };

export async function exchangeAndSaveToken(opts: {
  code: string;
  redirectUri: string;
  email: string;
  getToken: (_code: string, _redirectUri: string) => Promise<Response>;
  saveToken: (_opts: {
    email: string;
    refreshToken: string;
    expiresAt?: Date;
  }) => Promise<unknown>;
  onError: (_code: OAuthExchangeError, _error: unknown) => void;
}): Promise<OAuthExchangeResult> {
  let tokenData: TokenData;
  try {
    const tokenResponse = await opts.getToken(opts.code, opts.redirectUri);
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      opts.onError("exchange_failed", errorText);
      return { ok: false, code: "exchange_failed" };
    }
    tokenData = (await tokenResponse.json()) as TokenData;
  } catch (error) {
    opts.onError("exchange_failed", error);
    return { ok: false, code: "exchange_failed" };
  }

  try {
    // Mirrors Fleet.doTokenRefresh(): `expires_at` tracks the access
    // token's own lifetime, not the (much longer-lived) refresh token's —
    // it's an internal staleness marker, not a user-facing expiry.
    await opts.saveToken({
      email: opts.email,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    });
  } catch (error) {
    opts.onError("save_failed", error);
    return { ok: false, code: "save_failed" };
  }

  return { ok: true };
}

export function buildTeslaAuthorizeUrl(opts: {
  clientId: string;
  baseAuthUrl: string;
  redirectUri: string;
  state: string;
}): string {
  return new URL(
    `/oauth2/v3/authorize?response_type=code&client_id=${encodeURIComponent(
      opts.clientId,
    )}&redirect_uri=${encodeURIComponent(opts.redirectUri)}&scope=openid%20offline_access%20user_data%20energy_device_data%20energy_cmds&state=${encodeURIComponent(opts.state)}`,
    opts.baseAuthUrl,
  ).toString();
}
