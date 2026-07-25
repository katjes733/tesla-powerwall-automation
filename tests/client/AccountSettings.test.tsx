/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const showNotification = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
const mockRegisterPasskey = vi.fn();

vi.mock("~/client/components/auth/AuthContext", () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  useAuth: () => ({ registerPasskey: mockRegisterPasskey }),
  WEBAUTHN_CREDENTIAL_STORAGE_KEY: "webauthnLastCredentialId",
}));

vi.mock("~/client/components/notification/NotificationContext", () => ({
  useNotification: () => ({ showNotification }),
}));

const mockPlatformAuthenticatorIsAvailable = vi.fn();

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

import AccountSettings from "~/client/components/account/AccountSettings";

const CREDENTIAL = {
  id: "row-1",
  credentialId: "cred-1",
  nickname: "iPhone",
  deviceType: "multiDevice",
  backedUp: true,
  transports: ["internal"],
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // AccountSettings labels its "Add" button per-platform (Face ID on iOS,
  // "a Passkey" elsewhere) — pin an iPhone UA so this file's assertions are
  // deterministic; label-adaptivity itself is covered in Login.test.tsx.
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1",
    configurable: true,
  });
  mockGet.mockResolvedValue({ data: { credentials: [CREDENTIAL] } });
});

describe("AccountSettings", () => {
  it("lists registered passkeys", async () => {
    render(<AccountSettings />);
    expect(await screen.findByText("iPhone")).toBeInTheDocument();
  });

  it("tags the credential matching the localStorage marker as 'This device'", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    render(<AccountSettings />);
    expect(await screen.findByText("This device")).toBeInTheDocument();
  });

  it("does not tag any credential when localStorage has no marker", async () => {
    render(<AccountSettings />);
    await screen.findByText("iPhone");
    expect(screen.queryByText("This device")).not.toBeInTheDocument();
  });

  it("registers a new passkey via the shared registerPasskey and refreshes 'this device'", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockRegisterPasskey.mockImplementation(async () => {
      localStorage.setItem("webauthnLastCredentialId", "cred-2");
    });

    const user = userEvent.setup();
    render(<AccountSettings />);
    await screen.findByText("iPhone");

    await user.click(screen.getByRole("button", { name: /add face id/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(mockRegisterPasskey).toHaveBeenCalled());
    expect(localStorage.getItem("webauthnLastCredentialId")).toBe("cred-2");
  });

  it("does not surface an error toast when the user cancels the OS prompt while adding", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockRegisterPasskey.mockRejectedValue(
      new MockWebAuthnError("ERROR_CEREMONY_ABORTED"),
    );
    const user = userEvent.setup();
    render(<AccountSettings />);
    await screen.findByText("iPhone");

    await user.click(screen.getByRole("button", { name: /add face id/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(mockRegisterPasskey).toHaveBeenCalled());
    expect(showNotification).not.toHaveBeenCalledWith(
      expect.any(String),
      "error",
    );
  });

  it("removes a passkey", async () => {
    mockDelete.mockResolvedValue({ data: { message: "Passkey removed" } });
    const user = userEvent.setup();
    render(<AccountSettings />);
    await screen.findByText("iPhone");

    await user.click(screen.getByRole("button", { name: /remove passkey/i }));

    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith(
        "/api/webauthn/credentials/row-1",
      ),
    );
  });

  it("clears the local 'this device' marker when deleting the credential it points to", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockDelete.mockResolvedValue({ data: { message: "Passkey removed" } });
    const user = userEvent.setup();
    render(<AccountSettings />);
    await screen.findByText("This device");

    await user.click(screen.getByRole("button", { name: /remove passkey/i }));

    await waitFor(() =>
      expect(localStorage.getItem("webauthnLastCredentialId")).toBeNull(),
    );
  });

  it("leaves the local 'this device' marker alone when deleting a different credential", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-other");
    mockDelete.mockResolvedValue({ data: { message: "Passkey removed" } });
    const user = userEvent.setup();
    render(<AccountSettings />);
    await screen.findByText("iPhone");

    await user.click(screen.getByRole("button", { name: /remove passkey/i }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    expect(localStorage.getItem("webauthnLastCredentialId")).toBe("cred-other");
  });
});
