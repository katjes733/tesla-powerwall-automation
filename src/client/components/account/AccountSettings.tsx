import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import FaceIcon from "@mui/icons-material/Face";
import KeyIcon from "@mui/icons-material/Key";
import {
  platformAuthenticatorIsAvailable,
  WebAuthnError,
} from "@simplewebauthn/browser";
import {
  axiosInstance,
  useAuth,
  WEBAUTHN_CREDENTIAL_STORAGE_KEY,
} from "~/client/components/auth/AuthContext";
import { getPasskeyLabel } from "~/client/components/auth/passkeyLabel";
import { useNotification } from "~/client/components/notification/NotificationContext";

interface PasskeyCredential {
  id: string;
  credentialId: string;
  nickname: string | null;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

// This page is the home for personal account-level settings — Face ID /
// passkeys today, other self-service preferences later — as distinct from
// site/schedule settings gated by the permission profile system.
export default function AccountSettings() {
  const { registerPasskey } = useAuth();
  const { showNotification } = useNotification();
  const [credentials, setCredentials] = useState<PasskeyCredential[] | null>(
    null,
  );
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [passkeyLabel] = useState(getPasskeyLabel);

  const load = useCallback(() => {
    axiosInstance
      .get<{ credentials: PasskeyCredential[] }>("/api/webauthn/credentials")
      .then((res) => setCredentials(res.data.credentials))
      .catch(() => showNotification("Failed to load passkeys", "error"));
  }, [showNotification]);

  useEffect(() => {
    load();
    setThisDeviceId(localStorage.getItem(WEBAUTHN_CREDENTIAL_STORAGE_KEY));
  }, [load]);

  const handleAdd = useCallback(async () => {
    setRegistering(true);
    try {
      const available = await platformAuthenticatorIsAvailable();
      if (!available) {
        showNotification(
          "This device/browser doesn't support Face ID or another passkey method",
          "error",
        );
        return;
      }
      await registerPasskey(nickname.trim() || undefined);
      setThisDeviceId(localStorage.getItem(WEBAUTHN_CREDENTIAL_STORAGE_KEY));
      setAddOpen(false);
      setNickname("");
      showNotification("Passkey added", "success");
      load();
    } catch (error: any) {
      // A user cancelling the OS prompt isn't a failure worth an error toast.
      if (!(
        error instanceof WebAuthnError &&
        error.code === "ERROR_CEREMONY_ABORTED"
      )) {
        showNotification(
          error.response?.data?.error ||
            error.message ||
            "Failed to add passkey",
          "error",
        );
      }
    } finally {
      setRegistering(false);
    }
  }, [nickname, showNotification, load, registerPasskey]);

  const handleDelete = useCallback(
    (id: string, credentialId: string) => {
      setDeletingId(id);
      axiosInstance
        .delete(`/api/webauthn/credentials/${id}`)
        .then(() => {
          // Removing the credential this browser itself uses — clear the
          // local marker too, so this device's login button/Conditional UI
          // and the post-login "set up a passkey?" prompt correctly treat
          // it as no longer enrolled, rather than pointing at a dead credential.
          if (credentialId === thisDeviceId) {
            localStorage.removeItem(WEBAUTHN_CREDENTIAL_STORAGE_KEY);
            setThisDeviceId(null);
          }
          showNotification("Passkey removed", "success");
          load();
        })
        .catch(() => showNotification("Failed to remove passkey", "error"))
        .finally(() => setDeletingId(null));
    },
    [showNotification, load, thisDeviceId],
  );

  return (
    <Box px={3} pb={3} sx={{ width: "100%", maxWidth: 868 }}>
      <Box mb={2}>
        <Typography variant="h5">Account Settings</Typography>
        <Typography variant="body2" color="text.secondary">
          Manage how you sign in and other account-specific preferences.
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            mb: 2,
          }}
        >
          <Box>
            <Typography variant="h6">Passkeys</Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in with {passkeyLabel} instead of your password.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={passkeyLabel === "Face ID" ? <FaceIcon /> : <KeyIcon />}
            onClick={() => setAddOpen(true)}
          >
            Add {passkeyLabel === "Face ID" ? "Face ID" : "a Passkey"}
          </Button>
        </Box>
        {credentials === null ? (
          <CircularProgress size={24} />
        ) : credentials.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No passkeys registered yet.
          </Typography>
        ) : (
          <List disablePadding>
            {credentials.map((cred) => (
              <ListItem
                key={cred.id}
                divider
                sx={{ flexWrap: "wrap", gap: 1, px: 0 }}
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label="Remove passkey"
                    onClick={() => handleDelete(cred.id, cred.credentialId)}
                    disabled={deletingId === cred.id}
                  >
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        flexWrap: "wrap",
                      }}
                    >
                      <Typography component="span">
                        {cred.nickname || "Passkey"}
                      </Typography>
                      {cred.credentialId === thisDeviceId && (
                        <Chip
                          label="This device"
                          size="small"
                          color="primary"
                        />
                      )}
                    </Box>
                  }
                  secondary={`Added ${formatDate(cred.createdAt)} · Last used ${formatDate(cred.lastUsedAt)}`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Dialog open={addOpen} onClose={() => !registering && setAddOpen(false)}>
        <DialogTitle>Add a passkey</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You'll be prompted by your browser/device to use {passkeyLabel}.
          </Typography>
          <TextField
            label="Name (optional)"
            placeholder="e.g. iPhone Face ID"
            fullWidth
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={registering}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={registering}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={registering}
          >
            {registering ? "Waiting…" : "Continue"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
