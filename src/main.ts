import { schedule } from "node-cron";
import parser from "cron-parser";
import moment from "moment-timezone";

import {
  getAllLiveStatus,
  getAllSiteInfo,
  setBackupReserveAll,
  setBackupReserveAllWhenFullyCharged,
} from "~/util/automation";
import { AppDataSource } from "~/database/datasource";

if (AppDataSource) {
  AppDataSource.initialize()
    .then(async () => {
      logger.info("✅ Database connection established successfully.");
      await AppDataSource?.query(
        `CREATE SCHEMA IF NOT EXISTS "${process.env.DB_SCHEMA || "public"}";`,
      );
      logger.info("✅ Database schema ensured successfully.");
      await AppDataSource?.synchronize();
      logger.info("✅ Database migrations completed successfully.");
    })
    .catch((error) => {
      logger.error(error, "❌ Error during Data Source initialization:");
      process.exit(1);
    });
}

if (process.env.SCHEDULED_JOBS_DISABLED !== "true") {
  logger.info("Running scheduled jobs...");

  // Schedule at 9:00 AM (Phoenix) to set the reserve to 100%
  schedule(
    "0 9 * * *",
    async () => {
      const now = moment().tz("America/Phoenix");
      if (now.hour() === 9) {
        await setBackupReserveAll(100);
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
        await setBackupReserveAll(5);
      }
    },
    { timezone: "America/Phoenix" },
  );

  // Schedule a polling job every minute to check the battery charge state and automatically set to 5%
  schedule(
    "*/1 * * * *",
    async () => {
      await setBackupReserveAllWhenFullyCharged(5);
    },
    { timezone: "America/Phoenix" },
  );
} else {
  logger.info("Scheduled jobs are disabled.");

  // logger.info(await getAllSiteInfo());
  logger.info(await getAllLiveStatus());
  // await setBackupReserveAll(5);
  // await setBackupReserveAllWhenFullyCharged(5);
}
