import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  ALL_PERIOD_TYPES,
  PERIOD_LABELS,
  type PeriodType,
  type TouSeasonRates,
  type TouTimeBlock,
} from "~/shared/types/tou";

interface Props {
  periods: TouTimeBlock[];
  rates: TouSeasonRates;
  onChange: (rates: TouSeasonRates) => void;
}

export default function TouRateTable({ periods, rates, onChange }: Props) {
  const usedTypes = Array.from(new Set(periods.map((p) => p.type))).sort(
    (a, b) => ALL_PERIOD_TYPES.indexOf(a) - ALL_PERIOD_TYPES.indexOf(b),
  );

  if (usedTypes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Add periods above to configure pricing.
      </Typography>
    );
  }

  function setRate(rateKey: "buy" | "sell", type: PeriodType, value: string) {
    const num = parseFloat(value);
    onChange({
      ...rates,
      [rateKey]: {
        ...rates[rateKey],
        [type]: isNaN(num) ? 0 : num,
      },
    });
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Pricing ($/kWh)
      </Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Period</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Buy Rate</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Sell Rate</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {usedTypes.map((type) => (
              <TableRow key={type}>
                <TableCell sx={{ py: 0.5 }}>{PERIOD_LABELS[type]}</TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <TextField
                    type="number"
                    size="small"
                    value={(rates.buy[type] ?? 0).toFixed(2)}
                    slotProps={{
                      htmlInput: { step: 0.001, min: 0 },
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">$</InputAdornment>
                        ),
                      },
                    }}
                    onChange={(e) => setRate("buy", type, e.target.value)}
                    sx={{ width: 110 }}
                  />
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <TextField
                    type="number"
                    size="small"
                    value={(rates.sell[type] ?? 0).toFixed(2)}
                    slotProps={{
                      htmlInput: { step: 0.001, min: 0 },
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">$</InputAdornment>
                        ),
                      },
                    }}
                    onChange={(e) => setRate("sell", type, e.target.value)}
                    sx={{ width: 110 }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
