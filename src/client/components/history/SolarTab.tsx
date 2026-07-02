import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import EnergyChart, { ChartContainer } from "./EnergyChart";
import EnergySummaryCards from "./EnergySummaryCards";
import {
  COLORS,
  computeEnergyStats,
  mixFraction,
  toChartTime,
  withPercents,
  type PowerHistoryPoint,
} from "./energyUtils";

interface Props {
  points: PowerHistoryPoint[];
  timezone: string;
}

export default function SolarTab({ points, timezone }: Props) {
  const stats = computeEnergyStats(points);
  const { solarKwh, homeKwh, chargeKwh, gridExportKwh, energyIn, energyOut } =
    stats;

  const chartData = points.map((p) => ({
    time: toChartTime(p.timestamp),
    solar_kw: p.solar_power / 1000,
  }));

  const toHome = mixFraction(solarKwh, homeKwh, energyIn, energyOut);
  const toBattery = mixFraction(solarKwh, chargeKwh, energyIn, energyOut);
  const toGrid = mixFraction(solarKwh, gridExportKwh, energyIn, energyOut);

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <ChartContainer>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          mb={0.5}
        >
          Solar Generation (kW)
        </Typography>
        <EnergyChart
          data={chartData}
          series={[
            { dataKey: "solar_kw", label: "Solar", color: COLORS.solar },
          ]}
          timezone={timezone}
        />
      </ChartContainer>

      <Divider />

      <EnergySummaryCards
        title="Used by"
        items={withPercents([
          { label: "Home", kwh: toHome, color: COLORS.home },
          { label: "Powerwall", kwh: toBattery, color: COLORS.batteryCharge },
          { label: "Grid Export", kwh: toGrid, color: COLORS.gridExport },
        ])}
      />
    </Box>
  );
}
