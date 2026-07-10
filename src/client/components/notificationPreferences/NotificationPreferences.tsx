import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Box,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Switch,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { axiosInstance } from "~/client/components/auth/AuthContext";
import { useNotification } from "~/client/components/notification/NotificationContext";
import PermissionButton from "~/client/components/shared/PermissionButton";
import SiteMultiSelect from "~/client/components/shared/SiteMultiSelect";
import type { SiteOption } from "~/client/components/shared/SiteSingleSelect";
import {
  NOTIFICATION_TYPE_SCOPE,
  type NotificationPreferencesData,
  type NotificationType,
} from "~/shared/schemas/notificationPreferences";

// One row per entry here — adding a new notification type later is a
// labels-map addition, not a new render branch (see NOTIFICATION_TYPE_SCOPE
// in the shared schema for which rows render a SiteMultiSelect vs a Switch).
const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  calibration_events:
    "Calibration events (Tesla-initiated BMS lock / sustained discharge)",
  calibration_job_outcomes:
    "Calibration job outcomes (grid-rate & curve calibration)",
  site_action_failures:
    "Site setting change failures (backup reserve, exports, grid charging, mode)",
  site_status_unavailable:
    "Site status unavailable (site info / live status fetch failures)",
  schedule_issues: "Schedule issues (expired or failed to execute)",
  account_health: "Account health (Tesla token issues, site list unavailable)",
};

const NOTIFICATION_TYPES = Object.keys(
  NOTIFICATION_TYPE_LABELS,
) as NotificationType[];

type ResolvedPreferences = Required<NotificationPreferencesData>;

export default function NotificationPreferences() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { showNotification } = useNotification();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [prefs, setPrefs] = useState<ResolvedPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axiosInstance
      .get<{ success: boolean; data: SiteOption[] }>("/api/powerwall/sites")
      .then((res) => setSites(res.data.data))
      .catch(() => showNotification("Failed to load sites", "error"));
  }, [showNotification]);

  const load = useCallback(() => {
    setLoading(true);
    axiosInstance
      .get<{ success: boolean; data: ResolvedPreferences }>(
        "/api/notification-preferences",
      )
      .then((res) => setPrefs(res.data.data))
      .catch(() =>
        showNotification("Failed to load notification preferences", "error"),
      )
      .finally(() => setLoading(false));
  }, [showNotification]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = useCallback(() => {
    if (!prefs) return;
    setSaving(true);
    axiosInstance
      .patch<{ success: boolean; data: ResolvedPreferences }>(
        "/api/notification-preferences",
        prefs,
      )
      .then((res) => {
        setPrefs(res.data.data);
        showNotification("Notification preferences saved", "success");
      })
      .catch(() =>
        showNotification("Failed to save notification preferences", "error"),
      )
      .finally(() => setSaving(false));
  }, [prefs, showNotification]);

  // The SiteMultiSelect's own floating label always stays hidden — MUI's
  // outlined notch label is single-line and truncates these long descriptive
  // strings with an ellipsis (bad on mobile especially). An external
  // Typography carries the full text instead, wrapping normally across
  // lines; hideLabel keeps the label as the control's accessible name
  // without rendering it in the notch.
  const renderControl = (type: NotificationType) =>
    NOTIFICATION_TYPE_SCOPE[type] === "site" ? (
      <SiteMultiSelect
        sites={sites}
        value={prefs![type]}
        onChange={(value) => setPrefs({ ...prefs!, [type]: value })}
        label={NOTIFICATION_TYPE_LABELS[type]}
        hideLabel
        fullWidth
      />
    ) : (
      <Switch
        checked={prefs![type] === "*"}
        onChange={(e) =>
          setPrefs({ ...prefs!, [type]: e.target.checked ? "*" : [] })
        }
        // On desktop this renders bare (the label is external, to the
        // left) — slotProps.input here, not FormControlLabel, keeps it an
        // accessible name either way (MUI v7: inputProps no longer wires
        // aria-label through on Switch).
        slotProps={{ input: { "aria-label": NOTIFICATION_TYPE_LABELS[type] } }}
      />
    );

  const saveButton = (
    <PermissionButton
      permissionAction="notificationPreferences.access"
      variant="contained"
      onClick={handleSave}
      disabled={saving}
      startIcon={saving ? <CircularProgress size={16} /> : undefined}
    >
      Save
    </PermissionButton>
  );

  return (
    <Box px={3} pb={3} sx={{ width: "100%", maxWidth: 868 }}>
      <Box mb={2}>
        <Typography variant="h5">Notifications</Typography>
        <Typography variant="body2" color="text.secondary">
          Choose which emails you receive, and for which sites.
        </Typography>
      </Box>
      {loading || !prefs ? (
        <CircularProgress size={24} />
      ) : isMobile ? (
        <Paper
          variant="outlined"
          sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {NOTIFICATION_TYPES.map((type) =>
            NOTIFICATION_TYPE_SCOPE[type] === "site" ? (
              <Box key={type}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {NOTIFICATION_TYPE_LABELS[type]}
                </Typography>
                {renderControl(type)}
              </Box>
            ) : (
              <FormControlLabel
                key={type}
                control={renderControl(type)}
                label={
                  <Typography variant="body2">
                    {NOTIFICATION_TYPE_LABELS[type]}
                  </Typography>
                }
              />
            ),
          )}
          <Box>{saveButton}</Box>
        </Paper>
      ) : (
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            display: "grid",
            gridTemplateColumns: "minmax(260px, 460px) minmax(220px, 320px)",
            alignItems: "center",
            columnGap: 4,
            rowGap: 2,
          }}
        >
          {NOTIFICATION_TYPES.map((type, i) => (
            <Fragment key={type}>
              <Typography variant="body2">
                {NOTIFICATION_TYPE_LABELS[type]}
              </Typography>
              <Box>{renderControl(type)}</Box>
              {i < NOTIFICATION_TYPES.length - 1 && (
                <Box sx={{ gridColumn: "1 / -1" }}>
                  <Divider />
                </Box>
              )}
            </Fragment>
          ))}
          <Box sx={{ gridColumn: "1 / -1", pt: 1 }}>{saveButton}</Box>
        </Paper>
      )}
    </Box>
  );
}
