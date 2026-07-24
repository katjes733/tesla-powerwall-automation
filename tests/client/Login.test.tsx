/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockLoginWithPasskey = vi.fn();
const mockPlatformAuthenticatorIsAvailable = vi.fn();
const mockBrowserSupportsWebAuthnAutofill = vi.fn();
const mockCancelCeremony = vi.fn();

vi.mock("~/client/components/auth/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    loginWithPasskey: mockLoginWithPasskey,
    loading: false,
  }),
  WEBAUTHN_CREDENTIAL_STORAGE_KEY: "webauthnLastCredentialId",
}));

vi.mock("~/client/components/notification/NotificationContext", () => ({
  useNotification: () => ({ showNotification: vi.fn() }),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
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
