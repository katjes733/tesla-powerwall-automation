import { getAllLiveStatus } from "~/util/automation";
import AppDataSource from "./database/datasource";
import { Fleet } from "~/util/fleet";
import { Scheduler } from "./util/scheduling";

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
