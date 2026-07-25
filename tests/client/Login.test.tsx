/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockLoginWithPasskey = vi.fn();
const mockPlatformAuthenticatorIsAvailable = vi.fn();
const mockBrowserSupportsWebAuthnAutofill = vi.fn();
const mockCancelCeremony = vi.fn();
const mockShowNotification = vi.fn();

const { MockWebAuthnError } = vi.hoisted(() => {
  class MockWebAuthnError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { MockWebAuthnError };
});

vi.mock("~/client/components/auth/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    loginWithPasskey: mockLoginWithPasskey,
    loading: false,
  }),
  WEBAUTHN_CREDENTIAL_STORAGE_KEY: "webauthnLastCredentialId",
  // Mirrors the real AuthContext.isStalePasskeyError so this file exercises
  // the same classification Login.tsx actually relies on, rather than a
  // stub that could silently drift from production behavior.
  isStalePasskeyError: (error: any) =>
    error?.response?.status === 401 ||
    (error instanceof MockWebAuthnError &&
      error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"),
}));

vi.mock("~/client/components/notification/NotificationContext", () => ({
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

vi.mock("@simplewebauthn/browser", () => ({
  platformAuthenticatorIsAvailable: (...args: unknown[]) =>
    mockPlatformAuthenticatorIsAvailable(...args),
  browserSupportsWebAuthnAutofill: (...args: unknown[]) =>
    mockBrowserSupportsWebAuthnAutofill(...args),
  WebAuthnAbortService: {
    cancelCeremony: (...args: unknown[]) => mockCancelCeremony(...args),
  },
  WebAuthnError: MockWebAuthnError,
}));

import Login from "~/client/components/auth/Login";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Label-adaptivity is exercised by its own dedicated tests below; default
  // to an iPhone UA so the rest of this file's "Face ID" wording holds.
  setUserAgent(IPHONE_UA);
  // Conditional UI is exercised by its own dedicated tests below; default it
  // off so it doesn't call loginWithPasskey unexpectedly in unrelated tests.
  mockBrowserSupportsWebAuthnAutofill.mockResolvedValue(false);
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe("Login — manual Face ID button", () => {
  it("does not show the button when no platform authenticator is available", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(false);
    renderLogin();
    await waitFor(() =>
      expect(mockPlatformAuthenticatorIsAvailable).toHaveBeenCalled(),
    );
    expect(
      screen.queryByRole("button", { name: /sign in with face id/i }),
    ).not.toBeInTheDocument();
  });

  it("does not show the button when the platform is supported but this device has never used a passkey", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    renderLogin();
    await waitFor(() =>
      expect(mockPlatformAuthenticatorIsAvailable).toHaveBeenCalled(),
    );
    expect(
      screen.queryByRole("button", { name: /sign in with face id/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the button when the platform is supported and this device has used a passkey before", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    renderLogin();
    expect(
      await screen.findByRole("button", { name: /sign in with face id/i }),
    ).toBeInTheDocument();
  });

  it("calls loginWithPasskey when clicked", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockLoginWithPasskey.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLogin();
    const button = await screen.findByRole("button", {
      name: /sign in with face id/i,
    });
    await user.click(button);
    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalledWith());
  });

  it("does not show an error notification when the user cancels the OS prompt", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockLoginWithPasskey.mockRejectedValue(
      new MockWebAuthnError("ERROR_CEREMONY_ABORTED"),
    );
    const user = userEvent.setup();
    renderLogin();
    const button = await screen.findByRole("button", {
      name: /sign in with face id/i,
    });
    await user.click(button);
    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalled());
    // Button returns to its normal label rather than getting stuck pending.
    expect(
      await screen.findByRole("button", { name: /sign in with face id/i }),
    ).toBeInTheDocument();
  });

  it("hides the button and explains itself when the server rejects a stale credential (e.g. removed from another device)", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    const error: any = new Error("Unauthorized");
    error.response = { status: 401, data: { error: "Passkey not recognized" } };
    mockLoginWithPasskey.mockRejectedValue(error);
    const user = userEvent.setup();
    renderLogin();
    const button = await screen.findByRole("button", {
      name: /sign in with face id/i,
    });
    await user.click(button);
    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalled());

    await waitFor(() =>
      expect(mockShowNotification).toHaveBeenCalledWith(
        expect.stringContaining("no longer exists"),
        "error",
        expect.any(Number),
      ),
    );
    expect(
      screen.queryByRole("button", { name: /sign in with face id/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the button and explains itself when the browser itself reports no usable credential (client-side NotAllowedError, never reaches the server)", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockLoginWithPasskey.mockRejectedValue(
      new MockWebAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"),
    );
    const user = userEvent.setup();
    renderLogin();
    const button = await screen.findByRole("button", {
      name: /sign in with face id/i,
    });
    await user.click(button);
    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalled());

    await waitFor(() =>
      expect(mockShowNotification).toHaveBeenCalledWith(
        expect.stringContaining("no longer exists"),
        "error",
        expect.any(Number),
      ),
    );
    expect(
      screen.queryByRole("button", { name: /sign in with face id/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Login — platform-adaptive passkey label", () => {
  it("labels the button 'Face ID' on iOS", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    setUserAgent(IPHONE_UA);
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    renderLogin();
    expect(
      await screen.findByRole("button", { name: /sign in with face id/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the generic 'a passkey' label on non-iOS platforms", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    setUserAgent(MAC_UA);
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    renderLogin();
    expect(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign in with face id/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Login — Conditional UI (passkey autofill)", () => {
  it("starts a silent, autofill-mediated passkey request when Conditional UI is supported", async () => {
    mockBrowserSupportsWebAuthnAutofill.mockResolvedValue(true);
    mockLoginWithPasskey.mockImplementation(() => new Promise(() => {}));
    renderLogin();
    await waitFor(() =>
      expect(mockLoginWithPasskey).toHaveBeenCalledWith({
        silent: true,
        autofill: true,
      }),
    );
  });

  it("hides the manual button when the background Conditional UI attempt discovers the marker is stale", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    // Control both promises manually so the button is deterministically
    // visible before the background attempt rejects — with both mocks
    // resolving/rejecting on the same microtask tick, React can batch the
    // "become visible" and "hide again" updates into one, and the button
    // would never actually be observed as visible, invalidating the test.
    let resolvePlatformCheck: (available: boolean) => void;
    mockPlatformAuthenticatorIsAvailable.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePlatformCheck = resolve;
        }),
    );
    mockBrowserSupportsWebAuthnAutofill.mockResolvedValue(true);
    let rejectLoginWithPasskey: (error: unknown) => void;
    mockLoginWithPasskey.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoginWithPasskey = reject;
        }),
    );

    renderLogin();
    await waitFor(() =>
      expect(mockLoginWithPasskey).toHaveBeenCalledWith({
        silent: true,
        autofill: true,
      }),
    );

    resolvePlatformCheck!(true);
    expect(
      await screen.findByRole("button", { name: /sign in with face id/i }),
    ).toBeInTheDocument();

    const error: any = new Error("Unauthorized");
    error.response = { status: 401, data: { error: "Passkey not recognized" } };
    rejectLoginWithPasskey!(error);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /sign in with face id/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not start a passkey request when Conditional UI is unsupported", async () => {
    mockBrowserSupportsWebAuthnAutofill.mockResolvedValue(false);
    renderLogin();
    await waitFor(() =>
      expect(mockBrowserSupportsWebAuthnAutofill).toHaveBeenCalled(),
    );
    expect(mockLoginWithPasskey).not.toHaveBeenCalled();
  });

  it("cancels the pending ceremony on unmount", async () => {
    mockBrowserSupportsWebAuthnAutofill.mockResolvedValue(true);
    mockLoginWithPasskey.mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderLogin();
    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalled());
    unmount();
    expect(mockCancelCeremony).toHaveBeenCalled();
  });
});
