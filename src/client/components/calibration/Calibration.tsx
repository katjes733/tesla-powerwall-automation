import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useCallback, useEffect, useRef, useState } from "react";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import SiteSingleSelect, { type SiteOption } from "../shared/SiteSingleSelect";

interface SafeguardStatus {
  socOk: boolean;
  solarOk: boolean;
  onGrid: boolean;
  offPeakOk: boolean;
  socValue: number;
  solarKw: number;
  batteryKw: number;
  gridKw: number;
}

interface GridChargeRateData {
  kw: number;
  soc_percent: number;
  solar_kw: number;
  battery_kw: number;
  sample_count: number;
}

interface ChargeCurveBin {
  soc_percent: number;
  battery_kw: number;
  sample_count: number;
}

interface ChargeCurveData {
  bins: ChargeCurveBin[];
  total_sample_count: number;
  soc_range_percent: number;
  data_window_days: number;
  built_at: string;
}

interface CalibrationRecord {
  id: string;
  creation_time: string;
  calibration_data: GridChargeRateData;
}

interface CurveCalibrationRecord {
  id: string;
  creation_time: string;
  calibration_data: ChargeCurveData;
}

type CalibrationPhase = "ramp-up" | "sampling" | "done";
type CalibrationJobStatus = "running" | "complete" | "failed";

interface CalibrationJobResponse {
  status: CalibrationJobStatus;
  phase: CalibrationPhase;
  result?: CalibrationRecord;
  error?: string;
}

type CurveJobStatus = "running" | "complete" | "interrupted" | "failed";

interface CurveJobResponse {
  status: CurveJobStatus;
  phase: "charging" | "done";
  startSoc: number;
  currentSoc: number;
  sampleCount: number;
  error?: string;
}

interface CurveStatusResponse {
  sampleCount: number;
  minSoc: number | null;
  maxSoc: number | null;
  oldestDate: string | null;
  newestDate: string | null;
  socBinCount: number;
}

function jobStorageKey(siteId: string) {
  return `calibration_job_${siteId}`;
}

function curveJobStorageKey(siteId: string) {
  return `calibration_curve_job_${siteId}`;
}

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
      {children}
    </Paper>
  );
}

function SafeguardRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
      {ok ? (
        <CheckCircleOutlineIcon color="success" fontSize="small" />
      ) : (
        <ErrorOutlineIcon color="error" fontSize="small" />
      )}
      <Typography variant="body2">{label}</Typography>
    </Box>
  );
}

export default function Calibration() {
  const { showNotification } = useNotification();

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [activeTab, setActiveTab] = useState(0);
  const [safeguards, setSafeguards] = useState<SafeguardStatus | null>(null);
  const [calibration, setCalibration] = useState<CalibrationRecord | null>(
    null,
  );
  const [curveCalibration, setCurveCalibration] =
    useState<CurveCalibrationRecord | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CalibrationJobResponse | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  // Curve tab state
  const [curveJobStatus, setCurveJobStatus] = useState<CurveJobResponse | null>(
    null,
  );
  const [curveStarting, setCurveStarting] = useState(false);
  const [curveStopping, setCurveStopping] = useState(false);
  const [curveStatus, setCurveStatus] = useState<CurveStatusResponse | null>(
    null,
  );

  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mainPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const curvePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fetchCalibrationData = useCallback(
    (siteId: string) => {
      if (!siteId) return;
      axiosInstance
        .get<{
          success: boolean;
          data: {
            calibration: CalibrationRecord | null;
            curveCalibration: CurveCalibrationRecord | null;
            safeguards: SafeguardStatus | null;
          };
        }>(`/api/calibration?siteId=${encodeURIComponent(siteId)}`)
        .then((res) => {
          setSafeguards(res.data.data.safeguards);
          setCalibration(res.data.data.calibration);
          setCurveCalibration(res.data.data.curveCalibration);
        })
        .catch(() =>
          showNotification("Failed to load calibration data", "error"),
        );
    },
    [showNotification],
  );

  const fetchCurveStatus = useCallback((siteId: string) => {
    if (!siteId) return;
    axiosInstance
      .get<{ success: boolean; data: CurveStatusResponse }>(
        `/api/calibration/curve-status?siteId=${encodeURIComponent(siteId)}`,
      )
      .then((res) => setCurveStatus(res.data.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedSiteId) return;
    setLoadingData(true);
    setSafeguards(null);
    setCalibration(null);
    setCurveCalibration(null);
    setJobId(null);
    setJobStatus(null);
    setCurveJobStatus(null);
    setCurveStatus(null);

    const storedJobId = localStorage.getItem(jobStorageKey(selectedSiteId));
    if (storedJobId) {
      setJobId(storedJobId);
      setJobStatus({ status: "running", phase: "ramp-up" });
    }

    const storedCurveJobExists =
      localStorage.getItem(curveJobStorageKey(selectedSiteId)) !== null;
    if (storedCurveJobExists) {
      setCurveJobStatus({
        status: "running",
        phase: "charging",
        startSoc: 0,
        currentSoc: 0,
        sampleCount: 0,
      });
    }

    axiosInstance
      .get<{
        success: boolean;
        data: {
          calibration: CalibrationRecord | null;
          curveCalibration: CurveCalibrationRecord | null;
          safeguards: SafeguardStatus | null;
        };
      }>(`/api/calibration?siteId=${encodeURIComponent(selectedSiteId)}`)
      .then((res) => {
        setSafeguards(res.data.data.safeguards);
        setCalibration(res.data.data.calibration);
        setCurveCalibration(res.data.data.curveCalibration);
      })
      .catch(() => showNotification("Failed to load calibration data", "error"))
      .finally(() => setLoadingData(false));

    fetchCurveStatus(selectedSiteId);

    if (mainPollRef.current) clearInterval(mainPollRef.current);
    mainPollRef.current = setInterval(
      () => fetchCalibrationData(selectedSiteId),
      30_000,
    );
    return () => {
      if (mainPollRef.current) clearInterval(mainPollRef.current);
    };
  }, [selectedSiteId, fetchCalibrationData, fetchCurveStatus]);

  const pollJob = useCallback(
    (id: string) => {
      axiosInstance
        .get<{ success: boolean; data: CalibrationJobResponse }>(
          `/api/calibration/job?jobId=${encodeURIComponent(id)}`,
        )
        .then((res) => {
          const job = res.data.data;
          setJobStatus(job);
          if (job.status === "complete") {
            if (jobPollRef.current) clearInterval(jobPollRef.current);
            localStorage.removeItem(jobStorageKey(selectedSiteId));
            setJobId(null);
            showNotification("Calibration complete", "success");
            if (selectedSiteId) fetchCalibrationData(selectedSiteId);
          } else if (job.status === "failed") {
            if (jobPollRef.current) clearInterval(jobPollRef.current);
            localStorage.removeItem(jobStorageKey(selectedSiteId));
            setJobId(null);
            showNotification(
              `Calibration failed: ${job.error ?? "unknown error"}`,
              "error",
            );
          }
        })
        .catch((err: any) => {
          if (err?.response?.status === 404) {
            if (jobPollRef.current) clearInterval(jobPollRef.current);
            localStorage.removeItem(jobStorageKey(selectedSiteId));
            setJobId(null);
            setJobStatus(null);
          }
        });
    },
    [selectedSiteId, fetchCalibrationData, showNotification],
  );

  useEffect(() => {
    if (!jobId) return;
    pollJob(jobId);
    if (jobPollRef.current) clearInterval(jobPollRef.current);
    jobPollRef.current = setInterval(() => pollJob(jobId), 10_000);
    return () => {
      if (jobPollRef.current) clearInterval(jobPollRef.current);
    };
  }, [jobId, pollJob]);

  const handleStartCalibration = async () => {
    if (!selectedSiteId) return;
    setStarting(true);
    try {
      const res = await axiosInstance.post<{
        success: boolean;
        data: { jobId: string };
      }>("/api/calibration/start", { siteId: selectedSiteId });
      const id = res.data.data.jobId;
      localStorage.setItem(jobStorageKey(selectedSiteId), id);
      setJobId(id);
      setJobStatus({ status: "running", phase: "ramp-up" });
    } catch (err: any) {
      showNotification(
        err?.response?.data?.message ?? "Failed to start calibration",
        "error",
      );
    } finally {
      setStarting(false);
    }
  };

  const handleClearCalibration = async () => {
    setClearDialogOpen(false);
    if (!selectedSiteId) return;
    setClearing(true);
    try {
      await axiosInstance.delete("/api/calibration/clear", {
        data: { siteId: selectedSiteId },
      });
      setCalibration(null);
      showNotification("Calibration cleared", "success");
    } catch {
      showNotification("Failed to clear calibration", "error");
    } finally {
      setClearing(false);
    }
  };

  const pollCurveJob = useCallback(
    (siteId: string) => {
      axiosInstance
        .get<{ success: boolean; data: CurveJobResponse }>(
          `/api/calibration/curve-job?siteId=${encodeURIComponent(siteId)}`,
        )
        .then((res) => {
          const job = res.data.data;
          setCurveJobStatus(job);
          if (job.status === "complete" || job.status === "interrupted") {
            if (curvePollRef.current) clearInterval(curvePollRef.current);
            localStorage.removeItem(curveJobStorageKey(siteId));
            showNotification(
              job.status === "complete"
                ? "Curve calibration complete"
                : "Curve calibration stopped",
              "success",
            );
            fetchCalibrationData(siteId);
            fetchCurveStatus(siteId);
          } else if (job.status === "failed") {
            if (curvePollRef.current) clearInterval(curvePollRef.current);
            localStorage.removeItem(curveJobStorageKey(siteId));
            showNotification(
              `Curve calibration failed: ${job.error ?? "unknown error"}`,
              "error",
            );
          }
        })
        .catch((err: any) => {
          if (err?.response?.status === 404) {
            if (curvePollRef.current) clearInterval(curvePollRef.current);
            localStorage.removeItem(curveJobStorageKey(siteId));
            setCurveJobStatus(null);
          }
        });
    },
    [showNotification, fetchCalibrationData, fetchCurveStatus],
  );

  useEffect(() => {
    if (!selectedSiteId) return;
    const stored = localStorage.getItem(curveJobStorageKey(selectedSiteId));
    if (!stored || curveJobStatus?.status !== "running") return;
    pollCurveJob(selectedSiteId);
    if (curvePollRef.current) clearInterval(curvePollRef.current);
    curvePollRef.current = setInterval(
      () => pollCurveJob(selectedSiteId),
      15_000,
    );
    return () => {
      if (curvePollRef.current) clearInterval(curvePollRef.current);
    };
  }, [selectedSiteId, curveJobStatus?.status === "running", pollCurveJob]);

  const handleStartCurveCalibration = async () => {
    if (!selectedSiteId) return;
    setCurveStarting(true);
    try {
      await axiosInstance.post("/api/calibration/curve-start", {
        siteId: selectedSiteId,
      });
      localStorage.setItem(curveJobStorageKey(selectedSiteId), "active");
      setCurveJobStatus({
        status: "running",
        phase: "charging",
        startSoc: safeguards?.socValue ?? 0,
        currentSoc: safeguards?.socValue ?? 0,
        sampleCount: 0,
      });
    } catch (err: any) {
      showNotification(
        err?.response?.data?.message ?? "Failed to start curve calibration",
        "error",
      );
    } finally {
      setCurveStarting(false);
    }
  };

  const handleStopCurveCalibration = async () => {
    if (!selectedSiteId) return;
    setCurveStopping(true);
    try {
      await axiosInstance.delete(
        `/api/calibration/curve-stop?siteId=${encodeURIComponent(selectedSiteId)}`,
      );
    } catch {
      showNotification("Failed to send stop signal", "error");
    } finally {
      setCurveStopping(false);
    }
  };

  const allSafeguardsOk =
    safeguards !== null &&
    safeguards.socOk &&
    safeguards.solarOk &&
    safeguards.onGrid &&
    safeguards.offPeakOk;
  const allCurveSafeguardsOk =
    safeguards !== null &&
    safeguards.socOk &&
    safeguards.onGrid &&
    safeguards.offPeakOk;
  const jobRunning = jobStatus?.status === "running";

  const phaseLabel =
    jobStatus?.phase === "ramp-up"
      ? "Waiting for charge rate to stabilize…"
      : jobStatus?.phase === "sampling"
        ? "Sampling charge rate…"
        : null;

  return (
    <Box sx={{ display: "flex", mt: 3, width: "100%" }}>
      {/* left spacer — yields space to content when viewport is narrow */}
      <Box sx={{ flex: "1 1 20%", minWidth: 0 }} />

      <Box sx={{ flex: "0 1 60%", minWidth: "min(480px, 100%)", px: 1 }}>
        <Typography variant="h5" gutterBottom>
          Calibration
        </Typography>

        <SiteSingleSelect
          sites={sites}
          value={selectedSiteId}
          onChange={setSelectedSiteId}
          fullWidth
          sx={{ mb: 2 }}
        />

        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
        >
          <Tab label="Grid Charge Rate" />
          <Tab label="Charge Curve" />
        </Tabs>

        {loadingData && (
          <Box sx={{ display: "flex", justifyContent: "center", my: 2 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {activeTab === 0 && selectedSiteId && !loadingData && (
          <>
            <SettingCard>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Live Readings
              </Typography>
              {safeguards ? (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 1,
                  }}
                >
                  <Typography variant="body2">
                    SOC: {safeguards.socValue}%
                  </Typography>
                  <Typography variant="body2">
                    Solar: {safeguards.solarKw} kW
                  </Typography>
                  <Typography variant="body2">
                    Battery:{" "}
                    {safeguards.batteryKw < 0
                      ? `${Math.abs(safeguards.batteryKw)} kW charging`
                      : safeguards.batteryKw > 0
                        ? `${safeguards.batteryKw} kW discharging`
                        : "idle"}
                  </Typography>
                  <Typography variant="body2">
                    Grid:{" "}
                    {safeguards.gridKw > 0
                      ? `${safeguards.gridKw} kW import`
                      : safeguards.gridKw < 0
                        ? `${Math.abs(safeguards.gridKw)} kW export`
                        : "0 kW"}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Live data unavailable
                </Typography>
              )}
            </SettingCard>

            <SettingCard>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Safeguards &amp; Calibration
              </Typography>

              {safeguards ? (
                <>
                  <SafeguardRow
                    ok={safeguards.socOk}
                    label={`SOC below 80% (currently ${safeguards.socValue}%)`}
                  />
                  <SafeguardRow
                    ok={safeguards.solarOk}
                    label={`Solar below 0.1 kW — night only (currently ${safeguards.solarKw} kW)`}
                  />
                  <SafeguardRow ok={safeguards.onGrid} label="On grid" />
                  <SafeguardRow
                    ok={safeguards.offPeakOk}
                    label="Off-peak period"
                  />
                </>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Safeguard status unavailable
                </Typography>
              )}

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 2, mb: 2 }}
              >
                Calibration must be performed at night (solar &lt; 0.1 kW),
                during off-peak hours, with SOC below 80%. When all conditions
                are met, click Start Calibration. The system will enable grid
                charging, wait for the charge rate to stabilize (detected
                dynamically — up to 10 minutes), sample for 3 minutes, then
                restore your previous grid charging state automatically.
              </Typography>

              {jobRunning && phaseLabel && (
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
                >
                  <CircularProgress size={18} />
                  <Typography variant="body2">{phaseLabel}</Typography>
                </Box>
              )}

              <Button
                variant="contained"
                onClick={handleStartCalibration}
                disabled={!allSafeguardsOk || jobRunning || starting}
                startIcon={
                  starting ? <CircularProgress size={16} /> : undefined
                }
              >
                {starting ? "Starting…" : "Start Calibration"}
              </Button>
            </SettingCard>

            <SettingCard>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Recorded Calibration
              </Typography>

              {calibration ? (
                <>
                  <Typography variant="body2" gutterBottom>
                    Grid charge rate:{" "}
                    <strong>
                      {(
                        calibration.calibration_data as GridChargeRateData
                      ).kw.toFixed(2)}{" "}
                      kW
                    </strong>
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    SOC at calibration:{" "}
                    {
                      (calibration.calibration_data as GridChargeRateData)
                        .soc_percent
                    }
                    %
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    Solar at calibration:{" "}
                    {
                      (calibration.calibration_data as GridChargeRateData)
                        .solar_kw
                    }{" "}
                    kW
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    Samples averaged:{" "}
                    {
                      (calibration.calibration_data as GridChargeRateData)
                        .sample_count
                    }
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Recorded:{" "}
                    {new Date(calibration.creation_time).toLocaleString()}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    sx={{ mt: 1 }}
                    onClick={() => setClearDialogOpen(true)}
                    disabled={clearing}
                    startIcon={
                      clearing ? <CircularProgress size={16} /> : undefined
                    }
                  >
                    {clearing ? "Clearing…" : "Clear Calibration"}
                  </Button>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No calibration recorded for this site.
                </Typography>
              )}
            </SettingCard>
          </>
        )}

        {activeTab === 1 && selectedSiteId && !loadingData && (
          <>
            <SettingCard>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Data Collection
              </Typography>
              {curveStatus ? (
                curveStatus.sampleCount === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No samples collected yet.
                  </Typography>
                ) : (
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 1,
                    }}
                  >
                    <Typography variant="body2">
                      Total samples: <strong>{curveStatus.sampleCount}</strong>
                    </Typography>
                    <Typography variant="body2">
                      Populated SOC bins:{" "}
                      <strong>{curveStatus.socBinCount}</strong>
                    </Typography>
                    <Typography variant="body2">
                      SOC range:{" "}
                      <strong>
                        {curveStatus.minSoc?.toFixed(1)}% –{" "}
                        {curveStatus.maxSoc?.toFixed(1)}%
                      </strong>
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {curveStatus.oldestDate
                        ? `Since ${new Date(curveStatus.oldestDate).toLocaleDateString()}`
                        : ""}
                    </Typography>
                  </Box>
                )
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1.5 }}
              >
                Samples are collected automatically on every smart charging tick
                while the battery is charging.
              </Typography>
            </SettingCard>

            <SettingCard>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Manual Curve Calibration
              </Typography>

              {safeguards ? (
                <>
                  <SafeguardRow
                    ok={safeguards.socOk}
                    label={`SOC below 80% (currently ${safeguards.socValue}%)`}
                  />
                  <SafeguardRow ok={safeguards.onGrid} label="On grid" />
                  <SafeguardRow
                    ok={safeguards.offPeakOk}
                    label="Off-peak period"
                  />
                </>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Safeguard status unavailable
                </Typography>
              )}

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 2, mb: 2 }}
              >
                Enables grid charging from current SOC to 100%, sampling every
                15 s. Covers the full SOC range that automatic collection may
                not reach. Takes up to 3 hours. Can be stopped early — any
                sufficient data collected will be saved.
              </Typography>

              {curveJobStatus?.status === "running" && (
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
                >
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    Charging… SOC {curveJobStatus.currentSoc.toFixed(1)}% →
                    100%, {curveJobStatus.sampleCount} samples
                  </Typography>
                </Box>
              )}

              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="contained"
                  onClick={handleStartCurveCalibration}
                  disabled={
                    !allCurveSafeguardsOk ||
                    curveJobStatus?.status === "running" ||
                    curveStarting
                  }
                  startIcon={
                    curveStarting ? <CircularProgress size={16} /> : undefined
                  }
                >
                  {curveStarting ? "Starting…" : "Start Curve Calibration"}
                </Button>

                {curveJobStatus?.status === "running" && (
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={handleStopCurveCalibration}
                    disabled={curveStopping}
                    startIcon={
                      curveStopping ? <CircularProgress size={16} /> : undefined
                    }
                  >
                    {curveStopping ? "Stopping…" : "Stop"}
                  </Button>
                )}
              </Box>
            </SettingCard>

            <SettingCard>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Current Lookup Table
              </Typography>

              {curveCalibration ? (
                (() => {
                  const data = curveCalibration.calibration_data;
                  const bins = data.bins ?? [];
                  const maxRate =
                    bins.length > 0
                      ? Math.max(...bins.map((b) => b.battery_kw))
                      : 0;
                  const minRate =
                    bins.length > 0
                      ? Math.min(...bins.map((b) => b.battery_kw))
                      : 0;
                  let biggestDrop = { soc: 0, drop: 0 };
                  for (let i = 1; i < bins.length; i++) {
                    const drop = bins[i - 1].battery_kw - bins[i].battery_kw;
                    if (drop > biggestDrop.drop) {
                      biggestDrop = { soc: bins[i].soc_percent, drop };
                    }
                  }
                  return (
                    <>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 1,
                          mb: 1,
                        }}
                      >
                        <Typography variant="body2">
                          Bins: <strong>{bins.length}</strong>
                        </Typography>
                        <Typography variant="body2">
                          SOC range:{" "}
                          <strong>{data.soc_range_percent?.toFixed(1)}%</strong>
                        </Typography>
                        <Typography variant="body2">
                          Max rate: <strong>{maxRate.toFixed(2)} kW</strong>
                        </Typography>
                        <Typography variant="body2">
                          Min rate: <strong>{minRate.toFixed(2)} kW</strong>
                        </Typography>
                        {biggestDrop.drop > 0 && (
                          <Typography
                            variant="body2"
                            sx={{ gridColumn: "span 2" }}
                          >
                            Largest step-down:{" "}
                            <strong>{biggestDrop.drop.toFixed(2)} kW</strong> at{" "}
                            {biggestDrop.soc.toFixed(1)}% SOC
                          </Typography>
                        )}
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ gridColumn: "span 2" }}
                        >
                          Built{" "}
                          {new Date(
                            curveCalibration.creation_time,
                          ).toLocaleString()}
                        </Typography>
                      </Box>
                    </>
                  );
                })()
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No curve data yet. Run a manual calibration or wait for
                  automatic collection to accumulate data across multiple SOC
                  levels.
                </Typography>
              )}
            </SettingCard>
          </>
        )}
      </Box>

      {/* right spacer — yields space to content when viewport is narrow */}
      <Box sx={{ flex: "1 1 20%", minWidth: 0 }} />

      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)}>
        <DialogTitle>Clear Calibration</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will delete all calibration data for this site. Smart charging
            will fall back to the component-counting formula until a new
            calibration is run.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleClearCalibration}
            color="error"
            variant="contained"
          >
            Clear
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
