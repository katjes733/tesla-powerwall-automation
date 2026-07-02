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

export default function GridTab({ points, timezone }: Props) {
  const stats = computeEnergyStats(points);
  const {
    gridImportKwh,
    gridExportKwh,
    homeKwh,
    chargeKwh,
    solarKwh,
    dischargeKwh,
    energyIn,
    energyOut,
  } = stats;

  const chartData = points.map((p) => ({
    time: toChartTime(p.timestamp),
    grid_kw: p.grid_power / 1000,
  }));

  const importToHome = mixFraction(gridImportKwh, homeKwh, energyIn, energyOut);
  const importToBattery = mixFraction(
    gridImportKwh,
    chargeKwh,
    energyIn,
    energyOut,
  );
  const exportFromSolar = mixFraction(
    solarKwh,
    gridExportKwh,
    energyIn,
    energyOut,
  );
  const exportFromBattery = mixFraction(
    dischargeKwh,
    gridExportKwh,
    energyIn,
    energyOut,
  );

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <ChartContainer>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          mb={0.5}
        >
          Grid Import / Export (kW)
        </Typography>
        <EnergyChart
          data={chartData}
          series={[
            {
              dataKey: "grid_kw",
              label: "Grid",
              color: COLORS.gridImport,
              negativeColor: COLORS.gridExport,
              positiveLabel: "Import",
              negativeLabel: "Export",
            },
          ]}
          showZeroLine
          timezone={timezone}
        />
      </ChartContainer>

      <Divider />

      <Box display="flex" flexDirection="column" gap={2}>
        <EnergySummaryCards
          title="Imported — used by"
          items={withPercents([
            { label: "Home", kwh: importToHome, color: COLORS.home },
            {
              label: "Powerwall",
              kwh: importToBattery,
              color: COLORS.batteryCharge,
            },
          ])}
        />
        <EnergySummaryCards
          title="Exported — from"
          items={withPercents([
            { label: "Solar", kwh: exportFromSolar, color: COLORS.solar },
            {
              label: "Powerwall",
              kwh: exportFromBattery,
              color: COLORS.batteryDischarge,
            },
          ])}
        />
      </Box>
    </Box>
  );
}
