import AppDataSource from "~/server/database/datasource";
import { Fleet } from "~/server/util/fleet";

const email = process.env.TESLA_ACCOUNT_EMAIL;
if (!email) {
  console.error("Missing TESLA_ACCOUNT_EMAIL in environment.");
  process.exit(1);
}

const filter = process.argv[2]?.toLowerCase();

await AppDataSource.getInstance(true);

const fleet = Fleet.getInstance(email, { throwOnError: true, mailOnError: false });
const allSites = await fleet.getEnergyProducts();

const sites = filter
  ? allSites.filter(
      (s) =>
        String(s.energy_site_id).toLowerCase().includes(filter) ||
        s.site_name?.toLowerCase().includes(filter),
    )
  : allSites;

if (sites.length === 0) {
  console.log(filter ? `No sites matching "${filter}".` : "No energy sites found.");
  process.exit(0);
}

const json = process.argv.includes("--json");

for (const site of sites) {
  const [live, info] = await Promise.all([
    fleet.getLiveStatus(site),
    fleet.getSiteInfo(site),
  ]);

  const siteName = info?.site_name ?? `Site ${site.energy_site_id}`;

  if (json) {
    console.log(JSON.stringify({ site, live, info }, null, 2));
    continue;
  }

  console.log(`\n=== ${siteName} (id: ${site.energy_site_id}) ===`);

  if (!live) {
    console.log("  No live status available.");
  } else {
    console.log("  -- Live Status --");
    console.log(`  Battery:      ${live.percentage_charged.toFixed(1)}%`);
    console.log(`  Grid:         ${live.grid_status} | ${(live.grid_power / 1000).toFixed(2)} kW`);
    console.log(`  Solar:        ${(live.solar_power / 1000).toFixed(2)} kW`);
    console.log(`  Battery flow: ${(live.battery_power / 1000).toFixed(2)} kW`);
    console.log(`  Home load:    ${(live.load_power / 1000).toFixed(2)} kW`);
    console.log(`  Storm mode:   ${live.storm_mode_active ? "active" : "off"}`);
    console.log(`  Island:       ${live.island_status}`);
    if (Object.keys(live.wall_connectors).length > 0) {
      console.log(`  Wall connectors: ${JSON.stringify(live.wall_connectors, null, 4)}`);
    }
  }

  if (info) {
    console.log("  -- Site Info --");
    console.log(`  Backup reserve:   ${info.backup_reserve_percent}%`);
    console.log(`  Mode:             ${info.default_real_mode}`);
    console.log(`  Installed:        ${info.installation_date}`);
    console.log(`  Timezone:         ${info.installation_time_zone}`);
    console.log(`  Battery count:    ${info.battery_count}`);
    console.log(`  Nameplate power:  ${(info.nameplate_power / 1000).toFixed(2)} kW`);
    console.log(`  Nameplate energy: ${(info.nameplate_energy / 1000).toFixed(2)} kWh`);
    console.log(`  Utility:          ${info.utility}`);
    console.log(`  Firmware:         ${info.version}`);
  }
}

await (await AppDataSource.getInstance()).destroy();
