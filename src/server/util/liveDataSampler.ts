import { schedule as scheduleTask } from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { Fleet } from "~/server/util/fleet";
import AppDataSource from "~/server/database/datasource";
import { getAllEmails } from "~/server/util/routes/refreshToken";

// Sample SoC for every active site every 5 minutes, aligned to the full hour.
export function startLiveDataSampler(): void {
  scheduleTask("*/5 * * * *", async () => {
    let emails: { id: string; email: string }[];
    try {
      emails = await getAllEmails();
    } catch (err) {
      logger.error(err, "[liveDataSampler] Failed to fetch emails");
      return;
    }

    const ds = await AppDataSource.getInstance(true);
    const repo = ds.getRepository("LiveDataSample");
    const now = new Date();

    for (const { email } of emails) {
      try {
        const fleet = Fleet.getInstance(email, {
          throwOnError: false,
          mailOnError: false,
        });
        const products = await fleet.getEnergyProducts();
        const statuses = await Promise.all(
          products.map((p) => fleet.getLiveStatus(p)),
        );
        for (let i = 0; i < products.length; i++) {
          const status = statuses[i];
          if (!status) continue;
          await repo.insert({
            id: uuidv4(),
            creation_time: now,
            modified_time: now,
            site_id: products[i].id,
            type: "soc",
            data: { soc_percent: status.percentage_charged },
          });
        }
      } catch (err) {
        logger.error(err, `[liveDataSampler] Failed to sample for ${email}`);
      }
    }
  });

  logger.info("[liveDataSampler] SoC sampler started (every 5 minutes)");
}
