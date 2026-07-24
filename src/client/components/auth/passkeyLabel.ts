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
