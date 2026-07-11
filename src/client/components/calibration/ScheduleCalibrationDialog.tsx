import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { axiosInstance } from "../auth/AuthContext";

type CalibrationType = "calibrate_grid_charge_rate" | "calibrate_charge_curve";

interface Props {
  open: boolean;
  onClose: () => void;
  calibrationType: CalibrationType;
  siteId: string;
  siteName: string;
  siteTimezone: string;
  // The latest one-time schedule for this site+action, if any (regardless of
  // its phase — pending or already completed) — fetched by the parent
  // Calibration page (see Calibration.tsx's fetchScheduleStatus), which is
  // also where its status and Cancel action are now displayed. This dialog
  // only needs the id, to replace it on Save.
  existingScheduleId?: string | null;
}

const LABELS: Record<CalibrationType, string> = {
  calibrate_grid_charge_rate: "Grid Charge Rate Calibration",
  calibrate_charge_curve: "Charge Curve Calibration",
};

export default function ScheduleCalibrationDialog({
  open,
  onClose,
  calibrationType,
  siteId,
  siteName,
  siteTimezone,
  existingScheduleId = null,
}: Props) {
  const [selectedDateTime, setSelectedDateTime] = useState<Dayjs | null>(null);
  const [saving, setSaving] = useState(false);
  const [peakWarning, setPeakWarning] = useState<{
    hasTouData: boolean;
    inPeak: boolean;
  } | null>(null);
  const [peakChecking, setPeakChecking] = useState(false);

  const peakDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedDateTime(null);
    setPeakWarning(null);
  }, [open]);

  const checkPeak = useCallback(
    (dt: Dayjs | null) => {
      if (peakDebounceRef.current) clearTimeout(peakDebounceRef.current);
      if (!dt || !dt.isValid()) {
        setPeakWarning(null);
        return;
      }
      peakDebounceRef.current = setTimeout(async () => {
        setPeakChecking(true);
        try {
          const params = new URLSearchParams({
            siteId,
            timestamp: dt.toISOString(),
          });
          const res = await axiosInstance.get(
            `/api/calibration/peak-status?${params}`,
          );
          setPeakWarning(res.data.data);
        } catch {
          setPeakWarning(null);
        } finally {
          setPeakChecking(false);
        }
      }, 400);
    },
    [siteId],
  );

  const handleDateTimeChange = (value: Dayjs | null) => {
    setSelectedDateTime(value);
    checkPeak(value);
  };

  const handleSave = async () => {
    if (!selectedDateTime || !selectedDateTime.isValid()) return;
    setSaving(true);
    try {
      if (existingScheduleId) {
        await axiosInstance.post("/api/schedule/delete", {
          id: existingScheduleId,
        });
      }
      const dt = selectedDateTime;
      const cron = `${dt.minute()} ${dt.hour()} ${dt.date()} ${dt.month() + 1} *`;
      const expiresAt = dt.add(10, "minute").toISOString();
      await axiosInstance.post("/api/schedule/upsert", {
        cron,
        timezone: siteTimezone,
        site_ids: [siteId],
        actions: [{ action: calibrationType, value: "{}" }],
        conditions: [],
        options: { runOnce: true, recovery: "none" },
        expires_at: expiresAt,
        enabled: true,
      });
      onClose();
    } catch {
      // noop — errors show in notification from parent or stay silent
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    selectedDateTime !== null &&
    selectedDateTime.isValid() &&
    selectedDateTime.isAfter(dayjs());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Schedule {LABELS[calibrationType]}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Site: <strong>{siteName}</strong>
        </Typography>

        <DateTimePicker
          label="Date &amp; time"
          value={selectedDateTime}
          onChange={handleDateTimeChange}
          disablePast
          slotProps={{ textField: { size: "small", fullWidth: true } }}
        />

        {peakChecking && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption">Checking peak status…</Typography>
          </Box>
        )}

        {!peakChecking && peakWarning?.hasTouData && peakWarning.inPeak && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            This time falls within an on-peak period. Calibration will be
            skipped and you will receive an email.
          </Alert>
        )}

        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mt: 1.5 }}
        >
          Runs in site timezone: {siteTimezone}
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mt: 1 }}
        >
          For weekly recurring scheduling, use the{" "}
          <Link component={RouterLink} to="/schedules" onClick={onClose}>
            Schedules
          </Link>{" "}
          page.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave || saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? "Scheduling…" : "Schedule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
