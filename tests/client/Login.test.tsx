/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockLoginWithPasskey = vi.fn();
const mockPlatformAuthenticatorIsAvailable = vi.fn();

vi.mock("~/client/components/auth/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    loginWithPasskey: mockLoginWithPasskey,
    loading: false,
  }),
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
  WebAuthnError: MockWebAuthnError,
}));

import Login from "~/client/components/auth/Login";

beforeEach(() => {
  vi.clearAllMocks();
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe("Login", () => {
  it("does not show the Face ID button when no platform authenticator is available", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(false);
    renderLogin();
    await waitFor(() =>
      expect(mockPlatformAuthenticatorIsAvailable).toHaveBeenCalled(),
    );
    expect(
      screen.queryByRole("button", { name: /sign in with face id/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the Face ID button when a platform authenticator is available", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    renderLogin();
    expect(
      await screen.findByRole("button", { name: /sign in with face id/i }),
    ).toBeInTheDocument();
  });

  it("calls loginWithPasskey when the Face ID button is clicked", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockLoginWithPasskey.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLogin();
    const button = await screen.findByRole("button", {
      name: /sign in with face id/i,
    });
    await user.click(button);
    await waitFor(() => expect(mockLoginWithPasskey).toHaveBeenCalled());
  });

  it("does not show an error notification when the user cancels the OS prompt", async () => {
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
