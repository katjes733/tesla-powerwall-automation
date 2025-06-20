import { schedule } from "node-cron";
import moment from "moment-timezone";
import { setBackupReserve } from "./util/gateway";

// Schedule at 9:00 AM (Phoenix) to set the reserve to 100%
schedule(
  "0 9 * * *",
  () => {
    const now = moment().tz("America/Phoenix");
    if (now.hour() === 9) {
      setBackupReserve(100);
    }
  },
  { timezone: "America/Phoenix" },
);

// Schedule at 14:00 (2:00 PM Phoenix) to set the reserve to 5%
schedule(
  "0 14 * * *",
  () => {
    const now = moment().tz("America/Phoenix");
    if (now.hour() === 14) {
      setBackupReserve(5);
    }
  },
  { timezone: "America/Phoenix" },
);
