/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const showNotification = vi.fn();
const mockRegisterPasskey = vi.fn();
const mockClosePasskeyPrompt = vi.fn();
const mockDismissPasskeyPromptPermanently = vi.fn();

let passkeyPromptOpen = true;

vi.mock("~/client/components/auth/AuthContext", () => ({
  useAuth: () => ({
    passkeyPromptOpen,
    closePasskeyPrompt: mockClosePasskeyPrompt,
    dismissPasskeyPromptPermanently: mockDismissPasskeyPromptPermanently,
    registerPasskey: mockRegisterPasskey,
  }),
}));

vi.mock("~/client/components/notification/NotificationContext", () => ({
  useNotification: () => ({ showNotification }),
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
  WebAuthnError: MockWebAuthnError,
}));

import PasskeyPrompt from "~/client/components/auth/PasskeyPrompt";

beforeEach(() => {
  vi.clearAllMocks();
  passkeyPromptOpen = true;
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1",
    configurable: true,
  });
});

describe("PasskeyPrompt", () => {
  it("renders nothing visible when closed", () => {
    passkeyPromptOpen = false;
    render(<PasskeyPrompt />);
    expect(screen.queryByText(/set up face id/i)).not.toBeInTheDocument();
  });

  it("offers to set up a passkey when open", () => {
    render(<PasskeyPrompt />);
    expect(
      screen.getByText(/set up face id for faster sign-in/i),
    ).toBeInTheDocument();
  });

  it("registers a passkey and closes on success", async () => {
    mockRegisterPasskey.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PasskeyPrompt />);

    await user.click(screen.getByRole("button", { name: /set up face id/i }));

    await waitFor(() => expect(mockRegisterPasskey).toHaveBeenCalled());
    expect(showNotification).toHaveBeenCalledWith("Face ID set up", "success");
    expect(mockClosePasskeyPrompt).toHaveBeenCalled();
  });

  it("keeps the dialog open (no error toast) when the user cancels the OS prompt", async () => {
    mockRegisterPasskey.mockRejectedValue(
      new MockWebAuthnError("ERROR_CEREMONY_ABORTED"),
    );
    const user = userEvent.setup();
    render(<PasskeyPrompt />);

    await user.click(screen.getByRole("button", { name: /set up face id/i }));

    await waitFor(() => expect(mockRegisterPasskey).toHaveBeenCalled());
    expect(showNotification).not.toHaveBeenCalled();
    expect(mockClosePasskeyPrompt).not.toHaveBeenCalled();
  });

  it("shows an error toast for a genuine registration failure", async () => {
    mockRegisterPasskey.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<PasskeyPrompt />);

    await user.click(screen.getByRole("button", { name: /set up face id/i }));

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith("boom", "error"),
    );
    expect(mockClosePasskeyPrompt).not.toHaveBeenCalled();
  });

  it("'Not now' closes without setting the dismissed flag", async () => {
    const user = userEvent.setup();
    render(<PasskeyPrompt />);

    await user.click(screen.getByRole("button", { name: /not now/i }));

    expect(mockClosePasskeyPrompt).toHaveBeenCalled();
    expect(mockDismissPasskeyPromptPermanently).not.toHaveBeenCalled();
  });

  it("'Don't ask again' dismisses permanently", async () => {
    const user = userEvent.setup();
    render(<PasskeyPrompt />);

    await user.click(screen.getByRole("button", { name: /don't ask again/i }));

    expect(mockDismissPasskeyPromptPermanently).toHaveBeenCalled();
  });
});
