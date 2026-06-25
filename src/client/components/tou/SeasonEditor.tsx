import { useState, useMemo } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import TextField from "@mui/material/TextField";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import TouTimeline from "./TouTimeline";
import TouPeriodList from "./TouPeriodList";
import TouRateTable from "./TouRateTable";
import type { TouSeason, TouTimeBlock } from "~/shared/types/tou";
import {
  validateSeason,
  formatCoverageIssue,
} from "~/shared/types/touValidation";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function daysInMonth(month: number): number[] {
  const count =
    [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
  return Array.from({ length: count }, (_, i) => i + 1);
}

function lastDayOfMonth(month: number): number {
  return daysInMonth(month).length;
}

function hasSubThirtyMinutes(periods: TouTimeBlock[]): boolean {
  return periods.some((p) => p.fromMinute % 30 !== 0 || p.toMinute % 30 !== 0);
}

function roundToNearest30(
  hour: number,
  minute: number,
): { hour: number; minute: number } {
  const total = Math.round((hour * 60 + minute) / 30) * 30;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

interface Props {
  season: TouSeason;
  onChange: (season: TouSeason) => void;
}

export default function SeasonEditor({ season, onChange }: Props) {
  const [showDays, setShowDays] = useState(
    () =>
      season.fromDay !== 1 || season.toDay !== lastDayOfMonth(season.toMonth),
  );
  const [minutePrecision, setMinutePrecision] = useState(() =>
    hasSubThirtyMinutes(season.periods),
  );

  const validation = useMemo(() => validateSeason(season), [season]);
  const [showPrecisionWarning, setShowPrecisionWarning] = useState(false);

  function patch(partial: Partial<TouSeason>) {
    onChange({ ...season, ...partial });
  }

  function handleToggleMinutePrecision(enabled: boolean) {
    if (!enabled && hasSubThirtyMinutes(season.periods)) {
      setShowPrecisionWarning(true);
    } else {
      setMinutePrecision(enabled);
    }
  }

  function confirmDowngrade() {
    const rounded = season.periods.map((p) => {
      const from = roundToNearest30(p.fromHour, p.fromMinute);
      const to = roundToNearest30(p.toHour, p.toMinute);
      return {
        ...p,
        fromHour: from.hour,
        fromMinute: from.minute,
        toHour: to.hour,
        toMinute: to.minute,
      };
    });
    patch({ periods: rounded });
    setMinutePrecision(false);
    setShowPrecisionWarning(false);
  }

  return (
    <Box display="flex" flexDirection="column" gap={2.5}>
      {/* Season name */}
      <TextField
        label="Season Name"
        size="small"
        value={season.name}
        onChange={(e) => patch({ name: e.target.value })}
        sx={{ maxWidth: 280 }}
      />

      {/* Date range */}
      <Box>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          mb={1}
        >
          <Typography variant="subtitle2">Season Date Range</Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showDays}
                onChange={(e) => setShowDays(e.target.checked)}
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                Day precision
              </Typography>
            }
            labelPlacement="start"
            sx={{ mr: 0 }}
          />
        </Box>
        <Grid container spacing={2} alignItems="center">
          <Grid size="auto">
            <Typography variant="body2" color="text.secondary">
              From
            </Typography>
          </Grid>
          <Grid size="auto">
            <Select
              size="small"
              value={season.fromMonth}
              onChange={(e) => patch({ fromMonth: Number(e.target.value) })}
              sx={{ minWidth: 120 }}
            >
              {MONTHS.map((m, i) => (
                <MenuItem key={i + 1} value={i + 1}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </Grid>
          {showDays && (
            <Grid size="auto">
              <Select
                size="small"
                value={season.fromDay}
                onChange={(e) => patch({ fromDay: Number(e.target.value) })}
                sx={{ minWidth: 70 }}
              >
                {daysInMonth(season.fromMonth).map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </Grid>
          )}
          <Grid size="auto">
            <Typography variant="body2" color="text.secondary">
              To
            </Typography>
          </Grid>
          <Grid size="auto">
            <Select
              size="small"
              value={season.toMonth}
              onChange={(e) => patch({ toMonth: Number(e.target.value) })}
              sx={{ minWidth: 120 }}
            >
              {MONTHS.map((m, i) => (
                <MenuItem key={i + 1} value={i + 1}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </Grid>
          {showDays && (
            <Grid size="auto">
              <Select
                size="small"
                value={season.toDay}
                onChange={(e) => patch({ toDay: Number(e.target.value) })}
                sx={{ minWidth: 70 }}
              >
                {daysInMonth(season.toMonth).map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </Grid>
          )}
        </Grid>
      </Box>

      <Divider />

      {/* Schedule */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Weekday Schedule (Mon–Fri)
        </Typography>
        <TouTimeline periods={season.periods} view="weekday" />
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Weekend Schedule (Sat–Sun)
        </Typography>
        <TouTimeline periods={season.periods} view="weekend" />
      </Box>

      {/* Periods */}
      <Box>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          mb={1}
        >
          <Typography variant="subtitle2">Periods</Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={minutePrecision}
                onChange={(e) => handleToggleMinutePrecision(e.target.checked)}
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                Minute precision
              </Typography>
            }
            labelPlacement="start"
            sx={{ mr: 0 }}
          />
        </Box>
        <TouPeriodList
          periods={season.periods}
          onChange={(periods) => patch({ periods })}
          minutePrecision={minutePrecision}
          periodIssues={validation.periodIssues}
        />
        {validation.coverageIssues.length > 0 && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            <AlertTitle>Schedule Coverage Issues</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {validation.coverageIssues.map((issue, i) => (
                <li key={i}>{formatCoverageIssue(issue)}</li>
              ))}
            </Box>
          </Alert>
        )}
      </Box>

      <Divider />

      <TouRateTable
        periods={season.periods}
        rates={season.rates}
        onChange={(rates) => patch({ rates })}
      />

      {/* Precision downgrade warning */}
      <Dialog
        open={showPrecisionWarning}
        onClose={() => setShowPrecisionWarning(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Reduce time precision?</DialogTitle>
        <DialogContent>
          <Typography>
            Some periods have times that are not on 30-minute boundaries.
            Switching to 30-minute precision will round them to the nearest 30
            minutes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPrecisionWarning(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={confirmDowngrade}
          >
            Round and switch
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
