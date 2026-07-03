import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputAdornment,
  Paper,
  Radio,
  RadioGroup,
  Slider,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import SiteSingleSelect, { type SiteOption } from "../shared/SiteSingleSelect";

interface SiteSettings {
  backupReserve: number;
  operationalMode: string;
  energyExports: string;
  gridCharging: string;
}

interface ScheduleAction {
  action: string;
  value: string;
}

interface Schedule {
  id: string;
  enabled: boolean;
  site_ids: string[];
  actions?: ScheduleAction[];
}

const OPERATIONAL_MODE_FROM_API: Record<string, string> = {
  self_consumption: "selfPowered",
  autonomous: "timeBasedControl",
};

const ENERGY_EXPORTS_FROM_API: Record<string, string> = {
  pv_only: "solarOnly",
  battery_ok: "everything",
};

const ACTION_DESCRIPTIONS = {
  backupReserve:
    "Backup reserve determines how much of your Powerwall's stored energy will automatically be saved for backup use. Setting it higher than the current state of charge will charge up the battery from solar or grid.",
  operationalMode: {
    selfPowered:
      "Use stored energy to power your home after the sun goes down. Reduces your reliance on the grid.",
    timeBasedControl:
      "Use stored energy to maximize savings based on your utility plan. Gives you the lowest energy bill.",
  },
  energyExports: {
    solarOnly:
      "In Time-Based Control, your system will only send solar energy to the grid during high-value time periods. Stored Powerwall energy will serve home loads.",
    everything:
      "Powerwall will export both solar production and stored Powerwall energy to the grid during high-cost time periods.",
  },
  gridCharging: {
    enabled:
      "Powerwall will charge from the grid to your backup reserve and for daily use in Time-Based Control.",
    disabled:
      "Powerwall will not charge from the grid and only use solar energy to charge the battery.",
  },
};

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
      {children}
    </Paper>
  );
}

export default function ManualSettings() {
  const { showNotification } = useNotification();

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [applying, setApplying] = useState<Record<string, boolean>>({});
  const [backupReserveInput, setBackupReserveInput] = useState<number>(20);

  const [pendingGridChargingValue, setPendingGridChargingValue] = useState<
    string | null
  >(null);
  const [smartChargingConflict, setSmartChargingConflict] = useState(false);

  useEffect(() => {
    axiosInstance
      .get<{ success: boolean; data: SiteOption[] }>("/api/powerwall/sites")
      .then((res) => {
        const list = res.data.data;
        setSites(list);
        const firstOnline = list.find((s) => s.is_online);
        if (firstOnline) setSelectedSiteId(firstOnline.id);
      })
      .catch(() => showNotification("Failed to load sites", "error"));
  }, []);

  const fetchStatus = useCallback(
    (siteId: string) => {
      setLoadingStatus(true);
      setSettings(null);
      axiosInstance
        .get<{ success: boolean; data: any[] }>("/api/powerwall/status")
        .then((res) => {
          const entry = res.data.data.find(
            (d: any) => String(d.product?.energy_site_id) === siteId,
          );
          if (!entry) {
            showNotification("Site status not found", "warning");
            return;
          }
          const info = entry.info;
          const gridChargingAllowed = !(
            info?.components?.disallow_charge_from_grid_with_solar_installed ??
            false
          );
          setSettings({
            backupReserve: info?.backup_reserve_percent ?? 20,
            operationalMode:
              OPERATIONAL_MODE_FROM_API[info?.default_real_mode] ??
              "selfPowered",
            energyExports:
              ENERGY_EXPORTS_FROM_API[
                info?.components?.customer_preferred_export_rule
              ] ?? "solarOnly",
            gridCharging: gridChargingAllowed ? "enabled" : "disabled",
          });
          setBackupReserveInput(info?.backup_reserve_percent ?? 20);
        })
        .catch(() => showNotification("Failed to load site status", "error"))
        .finally(() => setLoadingStatus(false));
    },
    [showNotification],
  );

  useEffect(() => {
    if (selectedSiteId) fetchStatus(selectedSiteId);
  }, [selectedSiteId, fetchStatus]);

  const applyAction = useCallback(
    async (action: string, value: string) => {
      setApplying((prev) => ({ ...prev, [action]: true }));
      try {
        await axiosInstance.post("/api/powerwall/apply-settings", {
          siteId: selectedSiteId,
          action,
          value,
        });
        showNotification("Setting applied successfully", "success");
        fetchStatus(selectedSiteId);
      } catch (err: any) {
        const msg = err?.response?.data?.message ?? "Failed to apply setting";
        showNotification(msg, "error");
      } finally {
        setApplying((prev) => ({ ...prev, [action]: false }));
      }
    },
    [selectedSiteId, fetchStatus, showNotification],
  );

  const handleGridChargingApply = useCallback(
    async (value: string) => {
      if (value === "disabled" && settings?.gridCharging === "enabled") {
        try {
          const res = await axiosInstance.get<{
            success: boolean;
            data: Schedule[];
          }>("/api/schedule/all", { params: { page: 1, pageSize: 100 } });
          const hasSmartCharging = res.data.data.some(
            (s) =>
              s.enabled &&
              s.site_ids.includes(selectedSiteId) &&
              s.actions?.some((a) => a.action === "setSmartGridCharging"),
          );
          if (hasSmartCharging) {
            setPendingGridChargingValue(value);
            setSmartChargingConflict(true);
            return;
          }
        } catch {
          // If schedule check fails, proceed without warning
        }
      }
      await applyAction("setGridCharging", value);
    },
    [settings, selectedSiteId, applyAction],
  );

  const confirmGridChargingOverride = useCallback(async () => {
    setSmartChargingConflict(false);
    if (pendingGridChargingValue) {
      await applyAction("setGridCharging", pendingGridChargingValue);
      setPendingGridChargingValue(null);
    }
  }, [pendingGridChargingValue, applyAction]);

  const cancelGridChargingOverride = useCallback(() => {
    setSmartChargingConflict(false);
    setPendingGridChargingValue(null);
  }, []);

  return (
    <Box sx={{ maxWidth: 680, mx: "auto", px: 2, pb: 10 }}>
      <Typography variant="h5" fontWeight={600} mb={1}>
        Manual Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Apply settings to your Powerwall immediately. These take effect right
        away and persist until a schedule changes them.
      </Typography>

      <SiteSingleSelect
        sites={sites}
        value={selectedSiteId}
        onChange={setSelectedSiteId}
        fullWidth
        sx={{ mb: 3 }}
      />

      {loadingStatus && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      )}

      {!loadingStatus && settings && (
        <>
          {/* Backup Reserve */}
          <SettingCard>
            <Typography variant="subtitle1" fontWeight={600} mb={0.5}>
              Backup Reserve
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              {ACTION_DESCRIPTIONS.backupReserve}
            </Typography>
            <Box display="flex" alignItems="center" gap={2}>
              <Slider
                value={backupReserveInput}
                onChange={(_, v) => setBackupReserveInput(v as number)}
                min={0}
                max={100}
                step={1}
                sx={{ flex: 1 }}
              />
              <TextField
                value={backupReserveInput}
                onChange={(e) => {
                  const v = Math.min(100, Math.max(0, Number(e.target.value)));
                  if (!isNaN(v)) setBackupReserveInput(v);
                }}
                type="number"
                size="small"
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">%</InputAdornment>
                    ),
                  },
                  htmlInput: { min: 0, max: 100 },
                }}
                sx={{ width: 100 }}
              />
            </Box>
            <Box display="flex" justifyContent="flex-end" mt={2}>
              <Button
                variant="contained"
                size="small"
                disabled={applying["setBackupReserve"]}
                onClick={() =>
                  applyAction("setBackupReserve", String(backupReserveInput))
                }
              >
                {applying["setBackupReserve"] ? (
                  <CircularProgress size={18} />
                ) : (
                  "Apply"
                )}
              </Button>
            </Box>
          </SettingCard>

          {/*Operational Mode */}
          <SettingCard>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              Operational Mode
            </Typography>
            <FormControl component="fieldset" fullWidth>
              <RadioGroup
                value={settings.operationalMode}
                onChange={(e) =>
                  setSettings((s) =>
                    s ? { ...s, operationalMode: e.target.value } : s,
                  )
                }
              >
                {(
                  [
                    { key: "selfPowered", label: "Self Powered" },
                    { key: "timeBasedControl", label: "Time-Based Control" },
                  ] as const
                ).map((opt) => (
                  <Box key={opt.key} mb={1}>
                    <FormControlLabel
                      value={opt.key}
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2" fontWeight={500}>
                          {opt.label}
                        </Typography>
                      }
                    />
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ ml: 4 }}
                    >
                      {ACTION_DESCRIPTIONS.operationalMode[opt.key]}
                    </Typography>
                  </Box>
                ))}
              </RadioGroup>
            </FormControl>
            <Box display="flex" justifyContent="flex-end" mt={2}>
              <Button
                variant="contained"
                size="small"
                disabled={applying["setOperationalMode"]}
                onClick={() =>
                  applyAction("setOperationalMode", settings.operationalMode)
                }
              >
                {applying["setOperationalMode"] ? (
                  <CircularProgress size={18} />
                ) : (
                  "Apply"
                )}
              </Button>
            </Box>
          </SettingCard>

          {/*Energy Exports */}
          <SettingCard>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              Permission to Export
            </Typography>
            <FormControl component="fieldset" fullWidth>
              <RadioGroup
                value={settings.energyExports}
                onChange={(e) =>
                  setSettings((s) =>
                    s ? { ...s, energyExports: e.target.value } : s,
                  )
                }
              >
                {(
                  [
                    { key: "solarOnly", label: "Solar Only" },
                    {
                      key: "everything",
                      label: "Everything (solar and battery)",
                    },
                  ] as const
                ).map((opt) => (
                  <Box key={opt.key} mb={1}>
                    <FormControlLabel
                      value={opt.key}
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2" fontWeight={500}>
                          {opt.label}
                        </Typography>
                      }
                    />
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ ml: 4 }}
                    >
                      {ACTION_DESCRIPTIONS.energyExports[opt.key]}
                    </Typography>
                  </Box>
                ))}
              </RadioGroup>
            </FormControl>
            <Box display="flex" justifyContent="flex-end" mt={2}>
              <Button
                variant="contained"
                size="small"
                disabled={applying["setEnergyExports"]}
                onClick={() =>
                  applyAction("setEnergyExports", settings.energyExports)
                }
              >
                {applying["setEnergyExports"] ? (
                  <CircularProgress size={18} />
                ) : (
                  "Apply"
                )}
              </Button>
            </Box>
          </SettingCard>

          {/*Grid Charging */}
          <SettingCard>
            <Typography variant="subtitle1" fontWeight={600} mb={2}>
              Grid Charging
            </Typography>
            <FormControl component="fieldset" fullWidth>
              <RadioGroup
                value={settings.gridCharging}
                onChange={(e) =>
                  setSettings((s) =>
                    s ? { ...s, gridCharging: e.target.value } : s,
                  )
                }
              >
                {(
                  [
                    { key: "enabled", label: "Enabled" },
                    { key: "disabled", label: "Disabled" },
                  ] as const
                ).map((opt) => (
                  <Box key={opt.key} mb={1}>
                    <FormControlLabel
                      value={opt.key}
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2" fontWeight={500}>
                          {opt.label}
                        </Typography>
                      }
                    />
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ ml: 4 }}
                    >
                      {ACTION_DESCRIPTIONS.gridCharging[opt.key]}
                    </Typography>
                  </Box>
                ))}
              </RadioGroup>
            </FormControl>
            <Box display="flex" justifyContent="flex-end" mt={2}>
              <Button
                variant="contained"
                size="small"
                disabled={applying["setGridCharging"]}
                onClick={() => handleGridChargingApply(settings.gridCharging)}
              >
                {applying["setGridCharging"] ? (
                  <CircularProgress size={18} />
                ) : (
                  "Apply"
                )}
              </Button>
            </Box>
          </SettingCard>
        </>
      )}

      <Dialog open={smartChargingConflict} onClose={cancelGridChargingOverride}>
        <DialogTitle>Smart Charging Active</DialogTitle>
        <DialogContent>
          <DialogContentText>
            A smart charging schedule is active for this site and may re-enable
            grid charging during its next charging window. Disabling it now will
            only persist until the schedule enables it again.
          </DialogContentText>
          <DialogContentText sx={{ mt: 1 }}>
            Do you want to disable grid charging anyway?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelGridChargingOverride}>Cancel</Button>
          <Button
            onClick={confirmGridChargingOverride}
            color="warning"
            variant="contained"
          >
            Disable anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
