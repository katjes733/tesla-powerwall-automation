import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import dayjs, { type Dayjs } from "dayjs";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import SiteSingleSelect, { type SiteOption } from "../shared/SiteSingleSelect";
import DayNavigator from "./DayNavigator";
import HomeTab from "./HomeTab";
import PowerwallTab from "./PowerwallTab";
import SolarTab from "./SolarTab";
import GridTab from "./GridTab";
import type { HistoryData } from "./energyUtils";

type TabValue = "home" | "powerwall" | "solar" | "grid";

interface SiteWithTimezone extends SiteOption {
  timezone: string;
}

interface CacheEntry {
  data: HistoryData;
  fetchedAt: number;
}

const TODAY_TTL_MS = 5 * 60 * 1000;

export default function EnergyHistory() {
  const { showNotification } = useNotification();

  const [sites, setSites] = useState<SiteWithTimezone[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [activeTab, setActiveTab] = useState<TabValue>("home");
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const isToday = selectedDate.isSame(dayjs(), "day");

  const cache = useRef(new Map<string, CacheEntry>());

  // Pull-to-refresh + swipe navigation
  const PULL_THRESHOLD = 72;
  const SWIPE_THRESHOLD = 50;
  const [pullY, setPullY] = useState(0);
  const pullYRef = useRef(0);
  const loadingRef = useRef(false);
  const isTodayRef = useRef(isToday);
  const fetchHistoryRef = useRef<(force?: boolean) => void>(() => {});
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    isTodayRef.current = isToday;
  }, [isToday]);

  useEffect(() => {
    axiosInstance
      .get<{ success: boolean; data: SiteWithTimezone[] }>(
        "/api/powerwall/sites",
      )
      .then((r) => {
        const data = r.data.data ?? [];
        setSites(data);
        const defaultSite =
          data.find((s: SiteWithTimezone) => s.is_online) ?? data[0];
        if (defaultSite) setSelectedSiteId(defaultSite.id);
      })
      .catch(() => showNotification("Failed to load sites", "error"));
  }, []);

  const selectedTimezone =
    sites.find((s) => s.id === selectedSiteId)?.timezone ?? "UTC";

  const fetchHistory = useCallback(
    async (forceRefresh = false) => {
      if (!selectedSiteId) return;
      const dateStr = selectedDate.format("YYYY-MM-DD");
      const cacheKey = `${selectedSiteId}:${dateStr}`;

      const cached = cache.current.get(cacheKey);
      if (cached && !forceRefresh) {
        const elapsed = Math.round(performance.now() - cached.fetchedAt);
        const fresh = isToday ? elapsed < TODAY_TTL_MS : true;
        if (fresh) {
          setHistoryData(cached.data);
          return;
        }
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({
          siteId: selectedSiteId,
          date: dateStr,
        });
        if (forceRefresh) params.set("refresh", "true");
        const response = await axiosInstance.get<{
          success: boolean;
          data: HistoryData;
        }>(`/api/powerwall/history?${params}`);
        const data = response.data.data;
        cache.current.set(cacheKey, { data, fetchedAt: performance.now() });
        setHistoryData(data);
      } catch {
        showNotification("Failed to load history data", "error");
      } finally {
        setLoading(false);
      }
    },
    [selectedSiteId, selectedDate, isToday, showNotification],
  );

  useEffect(() => {
    fetchHistoryRef.current = fetchHistory;
  }, [fetchHistory]);

  useEffect(() => {
    setHistoryData(null);
    fetchHistory();
  }, [selectedSiteId, selectedDate]);

  useEffect(() => {
    if (!isMobile) return;
    let startX = 0;
    let startY = 0;
    let pullActive = false;
    let gestureDecided = false;
    let onChart = false;

    function onStart(e: TouchEvent) {
      const target = e.target as HTMLElement | null;
      onChart = !!target?.closest("[data-energy-chart]");
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      pullActive = false;
      gestureDecided = false;
      if (!onChart && window.scrollY <= 0 && !loadingRef.current) {
        pullActive = true;
      }
    }
    function onMove(e: TouchEvent) {
      if (onChart) return;
      if (!pullActive) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!gestureDecided) {
        if (Math.abs(dx) > Math.abs(dy) + 5) {
          pullActive = false;
          setPullY(0);
          pullYRef.current = 0;
          return;
        }
        if (Math.abs(dy) > Math.abs(dx) + 5) {
          gestureDecided = true;
        }
      }

      if (dy <= 0) {
        pullActive = false;
        setPullY(0);
        pullYRef.current = 0;
        return;
      }
      e.preventDefault();
      const clamped = Math.min(dy * 0.5, PULL_THRESHOLD);
      setPullY(clamped);
      pullYRef.current = clamped;
    }
    function onEnd(e: TouchEvent) {
      if (onChart) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;

      // Horizontal swipe: navigate days (must be mostly horizontal)
      if (
        Math.abs(dx) >= SWIPE_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        if (dx < 0 && !isTodayRef.current) {
          setSelectedDate((d) => d.add(1, "day"));
        } else if (dx > 0) {
          setSelectedDate((d) => d.subtract(1, "day"));
        }
        setPullY(0);
        pullYRef.current = 0;
        return;
      }

      if (!pullActive) return;
      pullActive = false;
      if (pullYRef.current >= PULL_THRESHOLD - 4) fetchHistoryRef.current(true);
      setPullY(0);
      pullYRef.current = 0;
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [isMobile]);

  const handlePrev = () => setSelectedDate((d) => d.subtract(1, "day"));
  const handleNext = () => {
    if (!isToday) setSelectedDate((d) => d.add(1, "day"));
  };

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: 900,
        mx: "auto",
        px: { xs: 1, sm: 3 },
        pb: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {/* Pull-to-refresh indicator */}
      {isMobile && pullY > 0 && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            overflow: "hidden",
            height: pullY,
            pb: 0.5,
          }}
        >
          <CircularProgress
            size={22}
            variant={
              pullY >= PULL_THRESHOLD - 4 ? "indeterminate" : "determinate"
            }
            value={(pullY / PULL_THRESHOLD) * 100}
          />
        </Box>
      )}

      <Box
        display="flex"
        flexDirection={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "stretch", sm: "center" }}
        gap={2}
        justifyContent="space-between"
      >
        <Typography
          variant="h6"
          fontWeight={600}
          sx={{ display: { xs: "none", sm: "block" } }}
        >
          Energy History
        </Typography>
        <Box
          display="flex"
          flexDirection={{ xs: "column", sm: "row" }}
          alignItems="center"
          gap={2}
          sx={{ width: { xs: "100%", sm: "auto" } }}
        >
          {sites.length > 0 && (
            <SiteSingleSelect
              sites={sites}
              value={selectedSiteId}
              onChange={setSelectedSiteId}
              size="small"
              sx={{ width: { xs: "100%", sm: "auto" } }}
            />
          )}
          <DayNavigator
            date={selectedDate}
            isToday={isToday}
            loading={loading}
            onPrev={handlePrev}
            onNext={handleNext}
            onDateChange={setSelectedDate}
            onRefresh={() => fetchHistory(true)}
            showRefresh={!isMobile}
          />
        </Box>
      </Box>

      <Tabs
        value={activeTab}
        onChange={(_, v: TabValue) => setActiveTab(v)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Home" value="home" />
        <Tab label="Powerwall" value="powerwall" />
        <Tab label="Solar" value="solar" />
        <Tab label="Grid" value="grid" />
      </Tabs>

      <Box sx={{ minHeight: 300 }}>
        {loading && (
          <Box display="flex" justifyContent="center" pt={6}>
            <CircularProgress />
          </Box>
        )}

        {!loading && !historyData && (
          <Box display="flex" justifyContent="center" pt={6}>
            <Typography color="text.secondary">
              No data available for this day.
            </Typography>
          </Box>
        )}

        {!loading && historyData && historyData.points.length === 0 && (
          <Box display="flex" justifyContent="center" pt={6}>
            <Typography color="text.secondary">
              No power data for this day.
            </Typography>
          </Box>
        )}

        {!loading && historyData && historyData.points.length > 0 && (
          <>
            {activeTab === "home" && (
              <HomeTab
                points={historyData.points}
                timezone={selectedTimezone}
              />
            )}
            {activeTab === "powerwall" && (
              <PowerwallTab
                points={historyData.points}
                socPoints={historyData.socPoints}
                timezone={selectedTimezone}
              />
            )}
            {activeTab === "solar" && (
              <SolarTab
                points={historyData.points}
                timezone={selectedTimezone}
              />
            )}
            {activeTab === "grid" && (
              <GridTab
                points={historyData.points}
                timezone={selectedTimezone}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
