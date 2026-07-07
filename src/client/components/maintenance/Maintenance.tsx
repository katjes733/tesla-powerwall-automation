import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import ConfirmDialog from "../shared/ConfirmDialog";

interface RefreshTokenStatus {
  email: string;
  hasToken: boolean;
  stale: boolean;
  lastRefreshedAt: string | null;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  missing_params: "Tesla did not return the expected authorization code.",
  session_expired:
    "Your session expired before authorization completed. Please try again.",
  invalid_state:
    "This authorization link is no longer valid. Please try again.",
  expired:
    "This authorization attempt took too long and expired. Please try again.",
  exchange_failed: "Tesla rejected the authorization code. Please try again.",
  save_failed:
    "The new refresh token could not be saved. Please try again or contact support.",
};

function SettingCard({ children }: { children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
      {children}
    </Paper>
  );
}

function StatusChip({ status }: { status: RefreshTokenStatus }) {
  if (!status.hasToken) {
    return <Chip label="No token" color="error" size="small" />;
  }
  if (status.stale) {
    return <Chip label="Needs attention" color="warning" size="small" />;
  }
  return <Chip label="Healthy" color="success" size="small" />;
}

export default function Maintenance() {
  const { showNotification } = useNotification();
  const [status, setStatus] = useState<RefreshTokenStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchStatus = useCallback(() => {
    setLoadingStatus(true);
    axiosInstance
      .get<{ success: boolean; data: RefreshTokenStatus }>(
        "/api/maintenance/refresh-token/status",
      )
      .then((res) => setStatus(res.data.data))
      .catch(() =>
        showNotification("Failed to load refresh token status", "error"),
      )
      .finally(() => setLoadingStatus(false));
  }, [showNotification]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Tesla's OAuth flow runs in a separate tab (see startTokenRefresh); the
  // /callback page posts back its outcome here rather than reloading/
  // redirecting this page.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "tesla-oauth") return;
      if (event.data.status === "success") {
        showNotification("Refresh token regenerated successfully", "success");
        fetchStatus();
      } else if (event.data.status === "error") {
        showNotification(
          OAUTH_ERROR_MESSAGES[event.data.code] ??
            "Something went wrong during authorization.",
          "error",
        );
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchStatus, showNotification]);

  const startTokenRefresh = useCallback(async () => {
    setConfirmOpen(false);
    setStarting(true);
    try {
      const res = await axiosInstance.post<{
        success: boolean;
        data: { authorizeUrl: string };
      }>("/api/maintenance/refresh-token/start");
      const popup = window.open(res.data.data.authorizeUrl, "_blank");
      if (!popup) {
        showNotification(
          "Please allow pop-ups for this site to continue.",
          "error",
        );
      }
    } catch {
      showNotification("Failed to start Tesla authorization", "error");
    } finally {
      setStarting(false);
    }
  }, [showNotification]);

  return (
    <Box sx={{ maxWidth: 680, mx: "auto", px: 2, pb: 10 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
        Maintenance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Administrative tools for maintaining this Tesla Powerwall Automation
        instance.
      </Typography>

      <SettingCard>
        <Typography variant="subtitle1" fontWeight={600}>
          Tesla Refresh Token
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This app uses a long-lived Tesla Fleet API refresh token to access
          your Powerwall on your behalf. If the token is missing, expired, or
          close to expiring, generate a new one by re-authenticating with Tesla.
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          The app automatically refreshes this token on its own. Only use this
          if something has gone seriously wrong — for example, the token was
          lost or revoked and automatic refresh has stopped working.
        </Alert>

        {loadingStatus ? (
          <CircularProgress size={20} />
        ) : (
          status && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 2,
                flexWrap: "wrap",
              }}
            >
              <Typography variant="body2">{status.email}</Typography>
              <StatusChip status={status} />
              {status.hasToken && status.lastRefreshedAt && (
                <Typography variant="body2" color="text.secondary">
                  Last refreshed{" "}
                  {dayjs(status.lastRefreshedAt).format("MMM D, YYYY h:mm A")}
                </Typography>
              )}
            </Box>
          )
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="contained"
            onClick={() => setConfirmOpen(true)}
            disabled={starting}
          >
            {starting ? (
              <CircularProgress size={20} />
            ) : (
              "Generate New Refresh Token"
            )}
          </Button>
        </Box>
      </SettingCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Regenerate Tesla Refresh Token?"
        description="Tesla's login and consent page will open in a new browser tab. This page will update automatically once you're done there."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={startTokenRefresh}
      />
    </Box>
  );
}
