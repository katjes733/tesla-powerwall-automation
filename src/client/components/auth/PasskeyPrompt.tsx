import { useCallback, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { WebAuthnError } from "@simplewebauthn/browser";
import { useAuth } from "./AuthContext";
import { useNotification } from "~/client/components/notification/NotificationContext";
import { getPasskeyLabel } from "./passkeyLabel";

// Rendered once, globally (see App.tsx) rather than from Login.tsx — Login
// already navigates away the instant a password login succeeds, so this
// shows as an overlay on top of whatever page that navigation lands on,
// satisfying "registration happens immediately, then the default page is
// shown" without fighting that existing redirect.
export default function PasskeyPrompt() {
  const {
    passkeyPromptOpen,
    closePasskeyPrompt,
    dismissPasskeyPromptPermanently,
    registerPasskey,
  } = useAuth();
  const { showNotification } = useNotification();
  const [registering, setRegistering] = useState(false);
  const [passkeyLabel] = useState(getPasskeyLabel);

  const handleSetUp = useCallback(async () => {
    setRegistering(true);
    try {
      await registerPasskey();
      showNotification(
        passkeyLabel === "Face ID" ? "Face ID set up" : "Passkey set up",
        "success",
      );
      closePasskeyPrompt();
    } catch (error: any) {
      // A user cancelling the OS prompt isn't a failure — leave the dialog
      // open so they can just try again rather than re-triggering the whole
      // post-login flow.
      if (!(
        error instanceof WebAuthnError &&
        error.code === "ERROR_CEREMONY_ABORTED"
      )) {
        showNotification(
          error.response?.data?.error ||
            error.message ||
            "Failed to set up passkey",
          "error",
        );
      }
    } finally {
      setRegistering(false);
    }
  }, [registerPasskey, showNotification, passkeyLabel, closePasskeyPrompt]);

  return (
    <Dialog
      open={passkeyPromptOpen}
      onClose={() => !registering && closePasskeyPrompt()}
    >
      <DialogTitle>Set up {passkeyLabel} for faster sign-in?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Next time, sign in with {passkeyLabel} instead of typing your
          password. You can add or remove this anytime from Account Settings.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button
          onClick={dismissPasskeyPromptPermanently}
          disabled={registering}
        >
          Don't ask again
        </Button>
        <Button onClick={closePasskeyPrompt} disabled={registering}>
          Not now
        </Button>
        <Button
          variant="contained"
          onClick={handleSetUp}
          disabled={registering}
        >
          {registering ? "Waiting…" : `Set up ${passkeyLabel}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
