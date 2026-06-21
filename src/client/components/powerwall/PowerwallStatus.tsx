import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import RefreshIcon from "@mui/icons-material/Refresh";
import { axiosInstance } from "../auth/AuthContext";
import SiteCard from "./SiteCard";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";

interface SiteStatus {
  product: Product;
  live: LiveStatus | null;
  info: SiteInfo | null;
  calibrating: boolean;
}

const INTERVAL_OPTIONS = [
  { label: "5s", value: 5_000 },
  { label: "10s", value: 10_000 },
  { label: "15s", value: 15_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
];

function secondsAgo(date: Date, now: number): string {
  const diff = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export default function PowerwallStatus() {
  const [sites, setSites] = useState<SiteStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalMs, setIntervalMs] = useState(30_000);
  const [hideOffGrid, setHideOffGrid] = useState(true);
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axiosInstance.get<{
        success: boolean;
        data: SiteStatus[];
      }>("/api/powerwall/status", { withCredentials: true });
      setSites(res.data.data);
      setLastUpdated(new Date());
      setError(null);
    } catch {
      setError("Failed to fetch Powerwall status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchStatus, intervalMs);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, intervalMs, fetchStatus]);

  // Update `now` every second so the "Xs ago" label re-renders with a real dependency
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <Box sx={{ width: "100%", maxWidth: 1200, mx: "auto", px: 2, mt: 4 }}>
      {/* Header row */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flex: 1 }}>
          Powerwall Status
        </Typography>
        <Box sx={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={hideOffGrid}
                onChange={(e) => setHideOffGrid(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">Hide off-grid</Typography>}
            sx={{ m: 0 }}
          />
        </Box>
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 1,
          }}
        >
          {lastUpdated && (
            <Typography variant="body2" color="text.secondary">
              Updated {secondsAgo(lastUpdated, now)}
            </Typography>
          )}
          <Tooltip title="Refresh now">
            <IconButton onClick={fetchStatus} size="small">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Select
            value={intervalMs}
            onChange={(e) => {
              setIntervalMs(Number(e.target.value));
              fetchStatus();
            }}
            size="small"
            disabled={!autoRefresh}
            sx={{ fontSize: "0.8rem", height: 32, minWidth: 68 }}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
          <Tooltip
            title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
          >
            <IconButton onClick={() => setAutoRefresh((v) => !v)} size="small">
              {autoRefresh ? (
                <PauseCircleIcon fontSize="small" />
              ) : (
                <PlayCircleIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && sites.length === 0 && (
        <Typography color="text.secondary">
          No Powerwall sites found.
        </Typography>
      )}

      {!loading && !error && sites.length > 0 && (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 3,
            justifyContent: "center",
          }}
        >
          {sites
            .filter(
              ({ live }) =>
                !hideOffGrid ||
                (live !== null && live.island_status === "on_grid"),
            )
            .map(({ product, live, info, calibrating }) => (
              <SiteCard
                key={product.energy_site_id}
                product={product}
                live={live}
                info={info}
                calibrating={calibrating}
              />
            ))}
        </Box>
      )}
    </Box>
  );
}
