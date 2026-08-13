import axios from "axios";
import { WebAuthnError } from "@simplewebauthn/browser";

export const axiosInstance = axios.create({ timeout: 5000 });

// Stashed on successful passkey registration/login so the Account Settings
// credential list can tag "This device" and the auto-refocus sign-in below
// only fires for devices that have actually enrolled a passkey before.
export const WEBAUTHN_CREDENTIAL_STORAGE_KEY = "webauthnLastCredentialId";

// Set when the user picks "Don't ask again" on the post-login "set up a
// passkey?" prompt — checked alongside WEBAUTHN_CREDENTIAL_STORAGE_KEY so a
// declined offer doesn't get re-asked on every future password login.
export const WEBAUTHN_PROMPT_DISMISSED_KEY = "webauthnPromptDismissed";

// A loginWithPasskey() rejection means this device's remembered credential no
// longer works, either because the server rejected it (removed on another
// device — surfaces as a 401) or because the browser itself reported no
// usable credential before ever reaching the server (a NotAllowedError,
// which @simplewebauthn/browser passes through as
// ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY). WebAuthn deliberately uses that same
// client-side error for both "no credential exists" and "user declined an
// existing one" — the spec forbids a site from telling those apart, so this
// errs toward treating it as stale; Conditional UI still works independently
// of the marker this clears, so a legitimate credential remains reachable.
export function isStalePasskeyError(error: any): boolean {
  return (
    error?.response?.status === 401 ||
    (error instanceof WebAuthnError &&
      error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY")
  );
}
