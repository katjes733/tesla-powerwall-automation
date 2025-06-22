import { v4 } from "uuid";
import open from "open";
import dedent from "dedent";
import { setEnvVar } from "~/util/env";
import type { TokenData } from "~/types/common";
import { getNewTokenWithCode } from "~/util/auth";

const clientId = process.env.TESLA_CLIENT_ID;
const clientSecret = process.env.TESLA_CLIENT_SECRET;
const redirectUri =
  process.env.TESLA_REDIRECT_URI || "http://localhost:3001/callback";
const baseAuthUrl =
  process.env.TESLA_AUTH_BASE_URL ||
  "https://fleet-auth.prd.vn.cloud.tesla.com";

if (!clientId || !clientSecret) {
  throw new Error(
    "Missing required environment variables: TESLA_CLIENT_ID or TESLA_CLIENT_SECRET",
  );
}

const state = v4();

const authUrl = new URL(
  `/oauth2/v3/authorize?response_type=code&client_id=${encodeURIComponent(
    clientId,
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20offline_access%20user_data%20energy_device_data%20energy_cmds&state=${encodeURIComponent(state)}`,
  baseAuthUrl,
).toString();

console.log("Please authorize in your browser.\n");
open(authUrl)
  .then(() => console.log("Browser opened.\n"))
  .catch((error) => console.error("Failed to open browser:", error));

const PORT = new URL(redirectUri).port || "3001";

let oauthServer: ReturnType<typeof Bun.serve>;

oauthServer = Bun.serve({
  port: Number(PORT),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Error: no authorization code provided.", {
          status: 400,
        });
      }

      try {
        const tokenResponse = await getNewTokenWithCode(code);

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error("Token endpoint error:", errorText);
          return new Response(
            `Token exchange failed: ${tokenResponse.statusText}`,
            { status: 500 },
          );
        }

        const tokenData = (await tokenResponse.json()) as TokenData;
        const refreshToken = tokenData.refresh_token;

        setEnvVar("TESLA_REFRESH_TOKEN", refreshToken);
        setEnvVar("TESLA_REDIRECT_URI", redirectUri);

        oauthServer.stop();
        console.log("Token refresh successful.");

        return new Response(
          dedent`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <title>Authorization Successful</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              :root {
                --bg-color: #ffffff;
                --text-color: #333;
                --accent-color: #007acc;
                color-scheme: light dark;
              }
              @media (prefers-color-scheme: dark) {
                :root {
                  --bg-color: #121212;
                  --text-color: #e4e6eb;
                  --accent-color: #58a6ff;
                }
              }
              body {
                margin: 0;
                padding: 2rem;
                background-color: var(--bg-color);
                color: var(--text-color);
                font-family: system-ui, sans-serif;
                text-align: center;
              }
              h1 {
                margin-top: 0;
                font-size: 2rem;
              }
              p {
                font-size: 1rem;
              }
            </style>
            <script>
              window.addEventListener('load', function() {
                setTimeout(function() {
                  window.open('', '_self');
                  window.close();
                }, 3000);
              });
            </script>
          </head>
          <body>
            <h1>Authorization Successful</h1>
            <p>You can now close this window.</p>
          </body>
          </html>`,
          {
            headers: { "Content-Type": "text/html" },
          },
        );
      } catch (error) {
        console.error("Error during token exchange:", error);
        return new Response("Error during token exchange", { status: 500 });
      }
    } else {
      return new Response("Not found", { status: 404 });
    }
  },
});
