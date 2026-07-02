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

export default function HomeTab({ points, timezone }: Props) {
  const stats = computeEnergyStats(points);
  const {
    solarKwh,
    dischargeKwh,
    gridImportKwh,
    homeKwh,
    energyIn,
    energyOut,
  } = stats;

  const chartData = points.map((p) => ({
    time: toChartTime(p.timestamp),
    home_kw: p.load_power / 1000,
  }));

  const fromSolar = mixFraction(solarKwh, homeKwh, energyIn, energyOut);
  const fromBattery = mixFraction(dischargeKwh, homeKwh, energyIn, energyOut);
  const fromGrid = mixFraction(gridImportKwh, homeKwh, energyIn, energyOut);

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <ChartContainer>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          mb={0.5}
        >
          Home Consumption (kW)
        </Typography>
        <EnergyChart
          data={chartData}
          series={[{ dataKey: "home_kw", label: "Home", color: COLORS.home }]}
          timezone={timezone}
        />
      </ChartContainer>

      <Divider />

      <EnergySummaryCards
        title="Powered by"
        items={withPercents([
          { label: "Solar", kwh: fromSolar, color: COLORS.solar },
          {
            label: "Powerwall",
            kwh: fromBattery,
            color: COLORS.batteryDischarge,
          },
          { label: "Grid", kwh: fromGrid, color: COLORS.gridImport },
        ])}
      />
    </Box>
  );
}
