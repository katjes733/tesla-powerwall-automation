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
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { axiosInstance } from "../auth/AuthContext";
import SiteCard from "./SiteCard";
import type { LiveStatus, Product, SiteInfo } from "~/server/types/common";

interface SiteStatus {
  product: Product;
  live: LiveStatus | null;
  info: SiteInfo | null;
  calibrating: boolean;
  activeHoliday: string | null;
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [sites, setSites] = useState<SiteStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalMs, setIntervalMs] = useState(30_000);
  const [hideOffGrid, setHideOffGrid] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [activeIndex, setActiveIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);

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

  const filteredSites = sites.filter(
    ({ live }) =>
      !hideOffGrid || (live !== null && live.island_status === "on_grid"),
  );

  // Clamp activeIndex when visible sites change
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filteredSites.length - 1)));
  }, [filteredSites.length]);

  function onSwipeStart(e: React.TouchEvent) {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  }

  function onSwipeEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    if (dx < 0)
      setActiveIndex((i) => Math.min(i + 1, filteredSites.length - 1));
    else setActiveIndex((i) => Math.max(i - 1, 0));
  }

  return (
    <Box sx={{ width: "100%", maxWidth: 1200, mx: "auto", px: 2 }}>
      {/* Header row */}
      <Box
        sx={{
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          flexDirection: { xs: "column", sm: "row" },
          gap: { xs: 1, sm: 0 },
          mb: 3,
        }}
      >
        <Typography
          variant="h5"
          fontWeight={600}
          sx={{ flex: 1, display: { xs: "none", sm: "block" } }}
        >
          Powerwall Status
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            flex: { xs: "none", sm: 1 },
            justifyContent: { xs: "flex-start", sm: "center" },
          }}
        >
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
            display: "flex",
            alignItems: "center",
            justifyContent: { xs: "flex-start", sm: "flex-end" },
            gap: 1,
            flex: { xs: "none", sm: 1 },
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

      {!loading && !error && filteredSites.length > 0 && (
        <>
          {/* Mobile: swipe carousel */}
          {isMobile ? (
            <>
              <Box
                sx={{ overflow: "hidden", width: "100%" }}
                onTouchStart={onSwipeStart}
                onTouchEnd={onSwipeEnd}
              >
                <Box
                  sx={{
                    display: "flex",
                    transform: `translateX(-${activeIndex * 100}%)`,
                    transition: "transform 0.3s ease",
                  }}
                >
                  {filteredSites.map(
                    ({ product, live, info, calibrating, activeHoliday }) => (
                      <Box
                        key={product.energy_site_id}
                        sx={{ flex: "0 0 100%", px: 0.5 }}
                      >
                        <SiteCard
                          product={product}
                          live={live}
                          info={info}
                          calibrating={calibrating}
                          activeHoliday={activeHoliday}
                        />
                      </Box>
                    ),
                  )}
                </Box>
              </Box>
              {filteredSites.length > 1 && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "center",
                    gap: 0.75,
                    mt: 1.5,
                  }}
                >
                  {filteredSites.map((_, i) => (
                    <Box
                      key={i}
                      onClick={() => setActiveIndex(i)}
                      sx={{
                        width: i === activeIndex ? 20 : 8,
                        height: 8,
                        borderRadius: 4,
                        bgcolor:
                          i === activeIndex
                            ? "primary.main"
                            : "action.disabled",
                        transition: "all 0.3s ease",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </Box>
              )}
            </>
          ) : (
            /* Desktop: existing flex-wrap grid */
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 3,
                justifyContent: "center",
              }}
            >
              {filteredSites.map(
                ({ product, live, info, calibrating, activeHoliday }) => (
                  <SiteCard
                    key={product.energy_site_id}
                    product={product}
                    live={live}
                    info={info}
                    calibrating={calibrating}
                    activeHoliday={activeHoliday}
                  />
                ),
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
