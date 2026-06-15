const clientId = process.env.TESLA_CLIENT_ID;
const clientSecret = process.env.TESLA_CLIENT_SECRET;
const redirectUri =
  process.env.TESLA_REDIRECT_URI || "http://localhost:3001/callback";
const baseAuthUrl =
  process.env.TESLA_AUTH_BASE_URL ||
  "https://fleet-auth.prd.vn.cloud.tesla.com";

export async function getNewTokenWithCode(code: string) {
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing required environment variables: TESLA_CLIENT_ID or TESLA_CLIENT_SECRET",
    );
  }
  const tokenEndpoint = new URL("/oauth2/v3/token", baseAuthUrl).toString();
  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("code", code);
  params.append("redirect_uri", redirectUri);

  return fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
}

export async function getNewTokenWithRefreshToken(refreshToken: string) {
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing required environment variables: TESLA_CLIENT_ID or TESLA_CLIENT_SECRET",
    );
  }
  const tokenEndpoint = new URL("/oauth2/v3/token", baseAuthUrl).toString();
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("refresh_token", refreshToken);

  return fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
}
