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
import http from "http";
import path from "path";

const httpLogger = pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) {
      return "error";
    } else if (res.statusCode >= 400) {
      return "warn";
    }
    return "debug";
  },
});

const app = express();

app.use(httpLogger);

app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "8aabb709b741d616652f9f79e76983e93338e4c5a1262946545311880721b6b4",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.SSL_ENABLED === "true",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  }),
);

app.disable("x-powered-by");

app.use("/api/powerwall", PowerwallRouter);
app.use("/api/health", HealthRouter);
app.use("/api/schedule", SchedulingRouter);
app.use("/api/session", SessionRouter);
app.use("/api/user", UserRouter);
app.use("/api/auth", SignupVerificationRouter);

if (process.env.NODE_ENV !== "development") {
  logger.info("Serving static files from 'public' directory");
  app.use(express.static(path.join(process.cwd(), "public")));
  app.use((req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
  });
} else {
  logger.info("Not in production mode");
}

const port = process.env.PORT || 3001;

let server = null;
if (process.env.SSL_ENABLED) {
  const https = require("https");
  const fs = require("fs");
  logger.info(`Current DIR: ${process.cwd()}`);
  logger.info(
    `Path to SSL key: ${path.join(process.cwd(), process.env.SSL_KEY_PATH || "/app/key.pem")}`,
  );
  const sslOptions = {
    key: fs.readFileSync(
      path.join(process.cwd(), process.env.SSL_KEY_PATH || "/app/key.pem"),
    ),
    cert: fs.readFileSync(
      path.join(process.cwd(), process.env.SSL_CERT_PATH || "/app/cert.pem"),
    ),
  };

  server = https.createServer(sslOptions, app);
  logger.info("SSL is enabled. Running server with HTTPS.");
} else {
  server = http.createServer(app);
  logger.info("SSL is not enabled. Running server with HTTP.");
}

server.listen(port, () => {
  logger.info(`Tesla Powerwall Automation is running on port ${port}`);
});

await AppDataSource.getInstance(false);

if (process.env.SCHEDULED_JOBS_DISABLED !== "true") {
  Scheduler.getInstance().initialize();
} else {
  // const email =
  //   process.env.TESLA_ACCOUNT_EMAIL ||
  //   (() => {
  //     throw new Error("TESLA_ACCOUNT_EMAIL environment variable is not set.");
  //   })();
  Scheduler.getInstance().initialize(false);

  // Fleet.getInstance(email, { mailOnError: true, throwOnError: false });

  // // logger.info(await getAllSiteInfo(email));
  // logger.info(await getAllLiveStatus(email));
  // // await setBackupReserveAll(5);
  // // await setBackupReserveAllWhenFullyCharged(5);
}
