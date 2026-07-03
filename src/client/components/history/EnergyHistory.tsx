import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
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

  const cache = useRef(new Map<string, CacheEntry>());

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

  const isToday = selectedDate.isSame(dayjs(), "day");

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
    setHistoryData(null);
    fetchHistory();
  }, [selectedSiteId, selectedDate]);

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
        px: 3,
        pb: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <Box
        display="flex"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
        justifyContent="space-between"
      >
        <Typography variant="h6" fontWeight={600}>
          Energy History
        </Typography>
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          {sites.length > 0 && (
            <SiteSingleSelect
              sites={sites}
              value={selectedSiteId}
              onChange={setSelectedSiteId}
              size="small"
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
