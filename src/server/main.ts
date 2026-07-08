import AppDataSource from "./database/datasource";
import { Scheduler } from "./util/scheduler";
import { pinoHttp } from "pino-http";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { router as PowerwallRouter } from "~/server/routes/powerwall";
import { router as SchedulingRouter } from "~/server/routes/scheduling";
import { router as HealthRouter } from "~/server/routes/health";
import { router as SessionRouter } from "~/server/routes/session";
import { router as UserRouter } from "~/server/routes/user";
import { router as SignupVerificationRouter } from "~/server/routes/signupVerification";
import { router as TouConfigRouter } from "~/server/routes/touConfig";
import {
  router as CalibrationRouter,
  recoverCurveCalibrations,
} from "~/server/routes/calibration";
import { router as SiteSettingsRouter } from "~/server/routes/siteSettings";
import { router as MaintenanceRouter } from "~/server/routes/maintenance";
import { router as UserAdminRouter } from "~/server/routes/userAdmin";
import { RedisStore } from "connect-redis";
import { redis } from "~/server/util/redis";
import { sendEmail } from "~/server/util/mailing";
import { getNewTokenWithCode } from "~/server/util/auth";
import { upsert as upsertRefreshToken } from "~/server/util/routes/refreshToken";
import {
  validateOAuthState,
  exchangeAndSaveToken,
} from "~/server/util/oauthCallback";
import { getPublicOrigin } from "~/server/util/requestOrigin";
import { materializePendingSignupIfAny } from "~/server/util/pendingSignup";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import path from "path";
import dedent from "dedent";
import { randomBytes } from "crypto";

// connect-redis v9 expects node-redis v4 API ({ EX: ttl }); ioredis v5 uses
// positional args ('EX', ttl). This adapter bridges the two.
const redisStoreClient = {
  get: (key: string) => redis.get(key),
  set: (key: string, value: string, options?: { EX?: number; PX?: number }) =>
    options?.EX != null
      ? redis.set(key, value, "EX", options.EX)
      : options?.PX != null
        ? redis.set(key, value, "PX", options.PX)
        : redis.set(key, value),
  del: (...keys: string[]) => redis.del(...keys),
  expire: (key: string, seconds: number) => redis.expire(key, seconds),
};

const httpLogger = pinoHttp({
  logger,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) {
      return "error";
    } else if (res.statusCode >= 400) {
      return "warn";
    }
    return "debug";
  },
});

const startupLog = logger.child({ service: "startup" });

const app = express();

app.use(httpLogger);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

startupLog.info({ allowedOrigins }, "CORS: allowed origins");

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "DELETE"],
  }),
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
if (
  !tokenEncryptionKey ||
  Buffer.from(tokenEncryptionKey, "hex").length !== 32
) {
  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 chars), e.g. openssl rand -hex 32",
  );
}

if (!process.env.TESLA_CLIENT_ID || !process.env.TESLA_CLIENT_SECRET) {
  throw new Error(
    "TESLA_CLIENT_ID and TESLA_CLIENT_SECRET environment variables are required",
  );
}

const sslEnabled = process.env.SSL_ENABLED === "true";
if (!sslEnabled && process.env.NODE_ENV !== "development") {
  startupLog.warn(
    "SSL_ENABLED is not set. Session cookies will be transmitted over plain HTTP. " +
      "Set SSL_ENABLED=true with a valid certificate for production use.",
  );
}

app.use(
  session({
    store: new RedisStore({ client: redisStoreClient as any }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: sslEnabled,
      // "lax" (not "strict") is required so the session cookie is still sent
      // on Tesla's top-level cross-site redirect back to /callback during the
      // OAuth flow; CSRF protection there comes from the explicit `state`
      // param, not from SameSite.
      sameSite: "lax",
      maxAge: 4 * 60 * 60 * 1000, // 4 hours
    },
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.use("/api/powerwall", PowerwallRouter);
app.use("/api/health", HealthRouter);
app.use("/api/schedule", SchedulingRouter);
app.use("/api/session", SessionRouter);
app.use("/api/user", UserRouter);
app.use("/api/auth", SignupVerificationRouter);
app.use("/api/tou-config", TouConfigRouter);
app.use("/api/calibration", CalibrationRouter);
app.use("/api/site-settings", SiteSettingsRouter);
app.use("/api/maintenance", MaintenanceRouter);
app.use("/api/user-admin", UserAdminRouter);

const oauthCallbackLog = logger.child({ service: "oauth-callback" });

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  missing_params: "Tesla did not return the expected authorization code.",
  session_expired:
    "Your session expired before authorization completed. Please try again.",
  invalid_state:
    "This authorization link is no longer valid. Please try again.",
  expired:
    "This authorization attempt took too long and expired. Please try again.",
  exchange_failed: "Tesla rejected the authorization code. Please try again.",
  save_failed:
    "The new refresh token could not be saved. Please try again or contact support.",
};

function renderOAuthCallbackPage(opts: {
  success: boolean;
  code?: string;
  nonce: string;
}) {
  const heading = opts.success
    ? "Authorization Successful"
    : "Authorization Failed";
  const message = opts.success
    ? "Your Tesla refresh token has been updated. This tab will close automatically."
    : (OAUTH_ERROR_MESSAGES[opts.code || ""] ??
      "Something went wrong during authorization.");
  const script = opts.success
    ? `window.opener && window.opener.postMessage({ source: "tesla-oauth", status: "success" }, window.location.origin);
        setTimeout(function () { window.close(); }, 1500);`
    : `window.opener && window.opener.postMessage({ source: "tesla-oauth", status: "error", code: ${JSON.stringify(opts.code || "unknown")} }, window.location.origin);`;

  return dedent`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${heading}</title>
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
        h1 { margin-top: 0; font-size: 2rem; }
        p { font-size: 1rem; }
        button {
          margin-top: 1rem;
          padding: 0.5rem 1.5rem;
          font-size: 1rem;
          border-radius: 6px;
          border: 1px solid var(--accent-color);
          background: transparent;
          color: var(--accent-color);
          cursor: pointer;
        }
      </style>
      <script nonce="${opts.nonce}">
        window.addEventListener('load', function() {
          ${script}
          document.getElementById('oauth-close-btn').addEventListener('click', function () {
            window.close();
          });
        });
      </script>
    </head>
    <body>
      <h1>${heading}</h1>
      <p>${message}</p>
      <button id="oauth-close-btn">Close this tab</button>
    </body>
    </html>`;
}

app.get("/callback", async (req, res) => {
  // This page is fully self-contained (no external resources), so it gets
  // its own tight, per-response CSP with a nonce for its inline <script>,
  // rather than relaxing the app-wide helmet policy.
  const nonce = randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'`,
  );

  const stored = req.session.oauthState;
  req.session.oauthState = undefined; // single-use, regardless of outcome

  const fail = (errorCode: string) => {
    res.type("html").send(
      renderOAuthCallbackPage({
        success: false,
        code: errorCode,
        nonce,
      }),
    );
  };

  const validation = validateOAuthState(
    {
      code: req.query.code as string | undefined,
      state: req.query.state as string | undefined,
    },
    stored,
    Date.now(),
  );
  if (!validation.ok) {
    fail(validation.code);
    return;
  }

  const redirectUri = `${getPublicOrigin(req)}/callback`;
  const result = await exchangeAndSaveToken({
    code: req.query.code as string,
    redirectUri,
    email: validation.email,
    getToken: getNewTokenWithCode,
    saveToken: upsertRefreshToken,
    onError: (code, error) =>
      oauthCallbackLog.error(
        { err: error, email: validation.email },
        code === "exchange_failed"
          ? "Tesla token exchange failed"
          : "Error saving new Tesla refresh token",
      ),
  });
  if (!result.ok) {
    fail(result.code);
    return;
  }

  // If this login was a pending (Redis-only) self-signup, completing Tesla
  // OAuth is what makes it a real, permanent account — materialize it now.
  // No-ops for every other callback (an existing owner's routine refresh).
  await materializePendingSignupIfAny(validation.email);

  oauthCallbackLog.info(
    { event: "oauth.callback.success", email: validation.email },
    "Tesla refresh token regenerated",
  );
  res.type("html").send(renderOAuthCallbackPage({ success: true, nonce }));
});

if (process.env.NODE_ENV !== "development") {
  startupLog.info("Serving static files from 'public' directory");
  app.use(express.static(path.join(process.cwd(), "public")));
  app.use((_req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
  });
} else {
  startupLog.info("Not in production mode");
}

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    startupLog.error({ err }, "Unhandled request error");
    const isDev = process.env.NODE_ENV === "development";
    res
      .status(500)
      .json({ error: isDev ? err.message : "Something went wrong" });
  },
);

const port = process.env.PORT || 3001;

let server;
if (sslEnabled) {
  const https = require("https");
  const fs = require("fs");
  const sslOptions = {
    key: fs.readFileSync(
      path.join(process.cwd(), process.env.SSL_KEY_PATH || "/app/key.pem"),
    ),
    cert: fs.readFileSync(
      path.join(process.cwd(), process.env.SSL_CERT_PATH || "/app/cert.pem"),
    ),
  };

  server = https.createServer(sslOptions, app);
  startupLog.info("SSL is enabled. Running server with HTTPS.");
} else {
  server = http.createServer(app);
  startupLog.info("SSL is not enabled. Running server with HTTP.");
}

server.listen(port, () => {
  startupLog.info(
    {
      port,
      ssl: sslEnabled,
      dryRun: process.env.DRY_RUN === "true",
      env: process.env.NODE_ENV,
    },
    "Tesla Powerwall Automation started",
  );
});

await AppDataSource.getInstance(false);

if (process.env.DRY_RUN === "true") {
  startupLog.warn(
    "DRY RUN mode is enabled. No Tesla API write calls will be made.",
  );
}

recoverCurveCalibrations().catch((err) => {
  startupLog.error({ err }, "Curve calibration recovery failed at startup");
  sendEmail(
    "Powerwall Notification",
    `[${new Date().toLocaleString()}] Curve calibration recovery failed at startup: ${err?.message ?? "Unknown error"}. In-progress calibrations may not have been resumed. Please check the server logs.`,
  );
});

if (process.env.SCHEDULED_JOBS_DISABLED !== "true") {
  Scheduler.getInstance()
    .initialize()
    .catch((err) => {
      startupLog.error({ err }, "Scheduler initialization failed");
      sendEmail(
        "Powerwall Notification",
        `[${new Date().toLocaleString()}] Scheduler failed to initialize: ${err?.message ?? "Unknown error"}. Scheduled tasks are not running. Please check the server logs.`,
      );
    });
} else {
  // const email =
  //   process.env.TESLA_ACCOUNT_EMAIL ||
  //   (() => {
  //     throw new Error("TESLA_ACCOUNT_EMAIL environment variable is not set.");
  //   })();
  Scheduler.getInstance().initialize(false);

  // Fleet.getInstance(email, { mailOnError: true, throwOnError: false });

  // // startupLog.info(await getAllSiteInfo(email));
  // startupLog.info(await getAllLiveStatus(email));
  // // await setBackupReserveAll(5);
  // // await setBackupReserveAllWhenFullyCharged(5);
}
