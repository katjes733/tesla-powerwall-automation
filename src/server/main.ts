import { getAllLiveStatus } from "~/server/util/automation";
import AppDataSource from "./database/datasource";
import { Fleet } from "~/server/util/fleet";
import { Scheduler } from "./util/scheduler";
import { pinoHttp } from "pino-http";
import express from "express";
import cookieParser from "cookie-parser";
import { router as SchedulingRouter } from "~/server/routes/scheduling";
import { router as HealthRouter } from "~/server/routes/health";
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

app.disable("x-powered-by");

app.use("/health", HealthRouter);
app.use("/schedule", SchedulingRouter);

app.use(express.static(path.join(process.cwd(), "public")));

app.use((req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

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
  logger.info("Running scheduled jobs...");

  Scheduler.getInstance().initialize();
} else {
  const email =
    process.env.TESLA_ACCOUNT_EMAIL ||
    (() => {
      throw new Error("TESLA_ACCOUNT_EMAIL environment variable is not set.");
    })();
  logger.info("Scheduled jobs are disabled.");

  Fleet.getInstance(email, { mailOnError: true, throwOnError: false });

  // logger.info(await getAllSiteInfo(email));
  logger.info(await getAllLiveStatus(email));
  // await setBackupReserveAll(5);
  // await setBackupReserveAllWhenFullyCharged(5);
}
