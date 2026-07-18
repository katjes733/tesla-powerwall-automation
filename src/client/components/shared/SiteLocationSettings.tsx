import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import PermissionButton from "./PermissionButton";
import type { ActionKey } from "~/shared/permissions/schema";

interface LocationSettings {
  location_zip: string | null;
  location_lat: number | null;
  location_lon: number | null;
}

const ZIP_REGEX = /^\d{5}$/;

interface SiteLocationSettingsProps {
  siteId: string;
  permissionAction: ActionKey;
}

// Self-contained card (fetch, edit, save) for a single site's weather-forecast
// location — drop it into any per-site settings page by passing a siteId and
// the permissionAction that should gate its Save/geolocation buttons.
export default function SiteLocationSettings({
  siteId,
  permissionAction,
}: SiteLocationSettingsProps) {
  const { showNotification } = useNotification();

  const [location, setLocation] = useState<LocationSettings | null>(null);
  const [zipInput, setZipInput] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  const fetchLocation = useCallback(
    (id: string) => {
      axiosInstance
        .get<{ success: boolean; data: LocationSettings }>(
          `/api/site-settings?siteId=${encodeURIComponent(id)}`,
        )
        .then((res) => {
          setLocation(res.data.data);
          setZipInput(res.data.data.location_zip ?? "");
        })
        .catch(() =>
          showNotification("Failed to load location setting", "error"),
        );
    },
    [showNotification],
  );

  useEffect(() => {
    if (siteId) fetchLocation(siteId);
  }, [siteId, fetchLocation]);

  const handleSaveZip = useCallback(async () => {
    if (!siteId) return;
    setSavingLocation(true);
    try {
      const res = await axiosInstance.patch<{
        success: boolean;
        data: LocationSettings;
      }>("/api/site-settings", {
        siteId,
        settings: { location_zip: zipInput || null },
      });
      setLocation(res.data.data);
      showNotification(
        zipInput ? "Location updated" : "Location cleared",
        "success",
      );
    } catch (err: any) {
      showNotification(
        err?.response?.data?.message ?? "Failed to update location",
        "error",
      );
    } finally {
      setSavingLocation(false);
    }
  }, [siteId, zipInput, showNotification]);

  const handleUseCurrentLocation = useCallback(() => {
    if (!siteId) return;
    if (!navigator.geolocation) {
      showNotification(
        "Your browser doesn't support location services",
        "error",
      );
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await axiosInstance.patch<{
            success: boolean;
            data: LocationSettings;
          }>("/api/site-settings", {
            siteId,
            settings: {
              location_lat: position.coords.latitude,
              location_lon: position.coords.longitude,
              location_zip: null,
            },
          });
          setLocation(res.data.data);
          // The server fills in the nearest ZIP for this lat/lon (purely a
          // friendly, editable approximation — the precise coordinates are
          // what's actually used for the weather forecast), so reflect it
          // here rather than leaving the field blank.
          setZipInput(res.data.data.location_zip ?? "");
          showNotification("Location updated from your browser", "success");
        } catch (err: any) {
          showNotification(
            err?.response?.data?.message ?? "Failed to update location",
            "error",
          );
        } finally {
          setGettingLocation(false);
        }
      },
      (error) => {
        setGettingLocation(false);
        showNotification(
          error.code === error.PERMISSION_DENIED
            ? "Location access denied — enter your ZIP code instead"
            : "Could not determine your location — try entering your ZIP code instead",
          "error",
        );
      },
      { timeout: 10_000, enableHighAccuracy: false },
    );
  }, [siteId, showNotification]);

  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={600} mb={0.5}>
        Location (for weather forecast)
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Used to fetch a solar radiation forecast for this site, improving how
        much the smart-charging planner trusts solar to cover a charging window.
        Optional — if left unset, the planner relies only on this site's own
        historical solar production.
      </Typography>

      {location &&
        (location.location_zip ||
          (location.location_lat != null && location.location_lon != null)) && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            Currently configured:{" "}
            {location.location_zip
              ? `ZIP ${location.location_zip} → ${location.location_lat?.toFixed(4)}, ${location.location_lon?.toFixed(4)}`
              : `Browser location: ${location.location_lat?.toFixed(4)}, ${location.location_lon?.toFixed(4)}`}
          </Typography>
        )}

      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <TextField
          label="ZIP code"
          value={zipInput}
          onChange={(e) => setZipInput(e.target.value.replace(/\D/g, ""))}
          size="small"
          slotProps={{ htmlInput: { maxLength: 5 } }}
          sx={{ width: 160 }}
        />
        <PermissionButton
          permissionAction={permissionAction}
          variant="contained"
          size="small"
          disabled={
            savingLocation || (zipInput !== "" && !ZIP_REGEX.test(zipInput))
          }
          onClick={handleSaveZip}
        >
          {savingLocation ? <CircularProgress size={18} /> : "Save"}
        </PermissionButton>
      </Box>

      {typeof navigator !== "undefined" && navigator.geolocation && (
        <>
          <Alert severity="info" sx={{ mb: 1 }}>
            Your browser will ask permission to share your location. It's used
            only to fetch a weather forecast for this site.
          </Alert>
          <PermissionButton
            permissionAction={permissionAction}
            variant="outlined"
            size="small"
            disabled={gettingLocation}
            onClick={handleUseCurrentLocation}
          >
            {gettingLocation ? (
              <CircularProgress size={18} />
            ) : (
              "Use My Current Location"
            )}
          </PermissionButton>
        </>
      )}
    </Paper>
  );
}
