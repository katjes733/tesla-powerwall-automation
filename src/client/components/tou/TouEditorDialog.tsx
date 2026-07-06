import { useState, useMemo } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import SeasonTabs from "./SeasonTabs";
import type { TouEditorState } from "~/shared/types/tou";
import {
  validateEditorState,
  formatValidationErrors,
  formatMonthIssues,
} from "~/shared/types/touValidation";

interface Props {
  open: boolean;
  state: TouEditorState;
  scheduleName: string;
  onScheduleNameChange: (name: string) => void;
  onChange: (state: TouEditorState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  nameExists?: boolean;
}

function fmt12h(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function applyOnPeakShift(
  state: TouEditorState,
  shiftMinutes: number,
): TouEditorState {
  if (shiftMinutes === 0) return state;
  return {
    ...state,
    seasons: state.seasons.map((season) => {
      // Collect all ON_PEAK start boundaries before mutating anything
      const boundaries = season.periods
        .filter((p) => p.type === "ON_PEAK")
        .map((p) => {
          const oldStart = p.fromHour * 60 + p.fromMinute;
          const newStart = (oldStart - shiftMinutes + 1440) % 1440;
          return { id: p.id, oldStart, newStart };
        });

      if (boundaries.length === 0) return season;

      const periods = season.periods.map((p) => {
        // ON_PEAK period: shift its start
        const asOnPeak = boundaries.find((b) => b.id === p.id);
        if (asOnPeak) {
          return {
            ...p,
            fromHour: Math.floor(asOnPeak.newStart / 60),
            fromMinute: asOnPeak.newStart % 60,
          };
        }
        // Adjacent period whose end coincides with an ON_PEAK start: shift its end
        const endMin = p.toHour * 60 + p.toMinute;
        const match = boundaries.find((b) => b.oldStart === endMin);
        if (match) {
          return {
            ...p,
            toHour: Math.floor(match.newStart / 60),
            toMinute: match.newStart % 60,
          };
        }
        return p;
      });

      return { ...season, periods };
    }),
  };
}

export default function TouEditorDialog({
  open,
  state,
  scheduleName,
  onScheduleNameChange,
  onChange,
  onSave,
  onClose,
  saving,
  nameExists = false,
}: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftMinutes, setShiftMinutes] = useState<15 | -15>(15);

  const validation = useMemo(() => validateEditorState(state), [state]);
  const validationErrors = useMemo(
    () => formatValidationErrors(validation, state),
    [validation, state],
  );
  const monthIssues = useMemo(
    () => formatMonthIssues(validation, state),
    [validation, state],
  );

  const hasOnPeak = state.seasons.some((s) =>
    s.periods.some((p) => p.type === "ON_PEAK"),
  );

  // First ON_PEAK period found across all seasons — used for preview in dialog
  const firstOnPeak = state.seasons
    .flatMap((s) => s.periods)
    .find((p) => p.type === "ON_PEAK");

  function patch(partial: Partial<TouEditorState>) {
    onChange({ ...state, ...partial });
  }

  function handleSaveClick() {
    if (validation.hasErrors) {
      setShowValidationErrors(true);
    } else {
      onSave();
    }
  }

  function handleClose() {
    setShowValidationErrors(false);
    onClose();
  }

  function handleApplyShift() {
    onChange(applyOnPeakShift(state, shiftMinutes));
    setShiftOpen(false);
  }

  const shiftEffectLabel =
    shiftMinutes === 15
      ? "On-Peak periods will start 15 minutes earlier"
      : "On-Peak periods will start 15 minutes later";

  const shiftPreview = (() => {
    if (!firstOnPeak) return null;
    const oldMin = firstOnPeak.fromHour * 60 + firstOnPeak.fromMinute;
    const newMin = (oldMin - shiftMinutes + 1440) % 1440;
    return `e.g. ${fmt12h(oldMin)} → ${fmt12h(newMin)}`;
  })();

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>TOU Schedule Editor</DialogTitle>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Config name + tariff metadata */}
            <Box display="flex" gap={2} flexWrap="wrap">
              <TextField
                label="Config Name"
                size="small"
                value={scheduleName}
                onChange={(e) => onScheduleNameChange(e.target.value)}
                sx={{ minWidth: 200, flex: 1 }}
                error={nameExists}
                helperText={
                  nameExists
                    ? "A config with this name already exists for this site"
                    : "How this config is saved in the list"
                }
              />
              <TextField
                label="Tariff Name"
                size="small"
                value={state.tariffName}
                onChange={(e) => patch({ tariffName: e.target.value })}
                sx={{ minWidth: 160, flex: 1 }}
                helperText="e.g. E27"
              />
              <TextField
                label="Utility"
                size="small"
                value={state.utility}
                onChange={(e) => patch({ utility: e.target.value })}
                sx={{ minWidth: 140, flex: 1 }}
                helperText="e.g. SRP"
              />
            </Box>

            {/* Seasons */}
            <Box>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                mb={monthIssues.length > 0 ? 1 : 0}
              >
                <Typography variant="subtitle1" fontWeight={600}>
                  Seasons
                </Typography>
                {isMobile ? (
                  <Tooltip title="Shift On-Peak Start…">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => setShiftOpen(true)}
                        disabled={!hasOnPeak}
                        color="primary"
                      >
                        <AccessTimeIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AccessTimeIcon />}
                    onClick={() => setShiftOpen(true)}
                    disabled={!hasOnPeak}
                    sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
                  >
                    Shift On-Peak Start…
                  </Button>
                )}
              </Box>
              {monthIssues.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {monthIssues.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </Box>
                </Alert>
              )}
              <SeasonTabs
                seasons={state.seasons}
                onSeasonsChange={(seasons) => patch({ seasons })}
              />
            </Box>

            {showValidationErrors && validation.hasErrors && (
              <Alert
                severity="error"
                onClose={() => setShowValidationErrors(false)}
              >
                <AlertTitle>
                  Cannot save — fix the following issues first
                </AlertTitle>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </Box>
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          {showValidationErrors && validation.hasErrors && (
            <Button
              variant="outlined"
              color="warning"
              onClick={onSave}
              disabled={saving}
            >
              Save Anyway
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleSaveClick}
            disabled={saving || !scheduleName.trim() || nameExists}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Shift On-Peak Start dialog */}
      <Dialog
        open={shiftOpen}
        onClose={() => setShiftOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Shift On-Peak Start Times</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2.5} pt={1}>
            <Typography variant="body2" color="text.secondary">
              Shift the start time of all On-Peak periods across every season.
              Adjacent periods are adjusted automatically to preserve full
              coverage.
            </Typography>

            <ToggleButtonGroup
              value={shiftMinutes}
              exclusive
              onChange={(_, v: 15 | -15 | null) => {
                if (v !== null) setShiftMinutes(v);
              }}
              size="small"
              fullWidth
            >
              <ToggleButton value={15}>15 min earlier</ToggleButton>
              <ToggleButton value={-15}>15 min later</ToggleButton>
            </ToggleButtonGroup>

            <Box
              sx={{
                bgcolor: "action.hover",
                borderRadius: 1,
                px: 2,
                py: 1.5,
                textAlign: "center",
              }}
            >
              <Typography variant="body2" fontWeight={500}>
                {shiftEffectLabel}
              </Typography>
              {shiftPreview && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  mt={0.5}
                >
                  {shiftPreview}
                </Typography>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShiftOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleApplyShift}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
