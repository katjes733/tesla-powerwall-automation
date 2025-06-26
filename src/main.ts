import { schedule } from "node-cron";
import parser from "cron-parser";
import moment from "moment-timezone";

import {
  getAllLiveStatus,
  getAllSiteInfo,
  setBackupReserveAll,
  setBackupReserveAllWhenFullyCharged,
} from "~/util/automation";
import AppDataSource from "./database/datasource";

await AppDataSource.getInstance(false);

const email =
  process.env.TESLA_ACCOUNT_EMAIL ||
  (() => {
    throw new Error("TESLA_ACCOUNT_EMAIL environment variable is not set.");
  })();

if (process.env.SCHEDULED_JOBS_DISABLED !== "true") {
  logger.info("Running scheduled jobs...");

  // Schedule at 9:00 AM (Phoenix) to set the reserve to 100%
  schedule(
    "0 9 * * *",
    async () => {
      const now = moment().tz("America/Phoenix");
      if (now.hour() === 9) {
        await setBackupReserveAll(100, email);
        const interval = parser.parse("0 9 * * *", {
          tz: "America/Phoenix",
        });
        logger.info(
          `Next run time for 9:00 AM job: ${interval.hasNext() ? interval.next().toString() : "N/A"}`,
        );
      }
    },
    { timezone: "America/Phoenix" },
  );

  // Schedule at 14:00 (2:00 PM Phoenix) to set the reserve to 5%
  schedule(
    "0 14 * * *",
    async () => {
      const now = moment().tz("America/Phoenix");
      if (now.hour() === 14) {
        await setBackupReserveAll(5, email);
      }
    },
    { timezone: "America/Phoenix" },
  );

  // Schedule a polling job every minute to check the battery charge state and automatically set to 5%
  schedule(
    "*/1 * * * *",
    async () => {
      await setBackupReserveAllWhenFullyCharged(5, email);
    },
    { timezone: "America/Phoenix" },
  );
} else {
  logger.info("Scheduled jobs are disabled.");

  logger.info(await getAllSiteInfo(email));
  logger.info(await getAllLiveStatus(email));
  // await setBackupReserveAll(5);
  // await setBackupReserveAllWhenFullyCharged(5);
}
