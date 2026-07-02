import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
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
  type SocPoint,
} from "./energyUtils";

interface Props {
  points: PowerHistoryPoint[];
  socPoints: SocPoint[];
  timezone: string;
}

export default function PowerwallTab({ points, socPoints, timezone }: Props) {
  const stats = computeEnergyStats(points);
  const {
    dischargeKwh,
    chargeKwh,
    homeKwh,
    gridExportKwh,
    solarKwh,
    gridImportKwh,
    energyIn,
    energyOut,
  } = stats;

  const batteryChartData = points.map((p) => ({
    time: toChartTime(p.timestamp),
    battery_kw: p.battery_power / 1000,
  }));

  const socChartData = socPoints.map((p) => ({
    time: toChartTime(p.timestamp),
    soc: p.soc_percent,
  }));

  const dischargeToHome = mixFraction(
    dischargeKwh,
    homeKwh,
    energyIn,
    energyOut,
  );
  const dischargeToGrid = mixFraction(
    dischargeKwh,
    gridExportKwh,
    energyIn,
    energyOut,
  );
  const chargeFromSolar = mixFraction(solarKwh, chargeKwh, energyIn, energyOut);
  const chargeFromGrid = mixFraction(
    gridImportKwh,
    chargeKwh,
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
          Discharge / Charge (kW)
        </Typography>
        <EnergyChart
          data={batteryChartData}
          series={[
            {
              dataKey: "battery_kw",
              label: "Battery",
              color: COLORS.batteryDischarge,
              negativeColor: COLORS.batteryCharge,
              positiveLabel: "Discharge",
              negativeLabel: "Charge",
            },
          ]}
          showZeroLine
          timezone={timezone}
        />
      </ChartContainer>

      <ChartContainer>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          mb={0.5}
        >
          Charge Level (%)
        </Typography>
        {socChartData.length > 0 ? (
          <EnergyChart
            data={socChartData}
            series={[
              {
                dataKey: "soc",
                label: "SoC",
                color: COLORS.soc,
                type: "area",
              },
            ]}
            unit="%"
            height={140}
            timezone={timezone}
          />
        ) : (
          <Alert severity="info" sx={{ mt: 1 }}>
            Charge level history is not yet available for this day. Data is
            collected going forward once the server is running.
          </Alert>
        )}
      </ChartContainer>

      <Divider />

      <Box display="flex" flexDirection="column" gap={2}>
        <EnergySummaryCards
          title="Discharged — used by"
          items={withPercents([
            { label: "Home", kwh: dischargeToHome, color: COLORS.home },
            {
              label: "Grid Export",
              kwh: dischargeToGrid,
              color: COLORS.gridExport,
            },
          ])}
        />
        <EnergySummaryCards
          title="Charged from"
          items={withPercents([
            { label: "Solar", kwh: chargeFromSolar, color: COLORS.solar },
            { label: "Grid", kwh: chargeFromGrid, color: COLORS.gridImport },
          ])}
        />
      </Box>
    </Box>
  );
}
