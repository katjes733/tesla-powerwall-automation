// There's no WebAuthn API that reveals which specific authenticator is
// present (by design, for privacy — see platformAuthenticatorIsAvailable()'s
// own doc comment). navigator.userAgent sniffing is the only way to guess,
// so this stays deliberately conservative: only the one case we can assert
// with real confidence (iOS/iPadOS's platform authenticator is always Face
// ID or Touch ID, marketed as "Face ID" everywhere in Apple's own UI) gets a
// specific name; everything else falls back to the generic, always-true
// "Passkey".
// Composes naturally in both "Sign in with {label}" and "Add {label}" —
// "Face ID" takes no article as a proper noun, "a passkey" carries its own.
export function getPasskeyLabel(): "Face ID" | "a passkey" {
  if (typeof navigator === "undefined") return "a passkey";
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? "Face ID" : "a passkey";
}

function getDeviceOS(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/iPod/.test(ua)) return "iPod";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

// Order matters: Edge and Chrome UAs both contain "Safari/", and Edge's
// contains "Chrome/" too, so the more specific browser must be checked first.
function getBrowserName(ua: string): string {
  if (/EdgiOS|EdgA|Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/CriOS|Chrome\//.test(ua)) return "Chrome";
  if (/FxiOS|Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "";
}

// A starting-point suggestion for naming a new passkey — never asserted as
// fact (see getPasskeyLabel's note on why UA-sniffing can't be precise), just
// a reasonable default the user can freely overwrite before confirming.
export function getDefaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const os = getDeviceOS(ua);
  const browser = getBrowserName(ua);
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "This device";
}
