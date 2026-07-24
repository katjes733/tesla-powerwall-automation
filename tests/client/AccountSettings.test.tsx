/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const showNotification = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock("~/client/components/auth/AuthContext", () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  WEBAUTHN_CREDENTIAL_STORAGE_KEY: "webauthnLastCredentialId",
}));

vi.mock("~/client/components/notification/NotificationContext", () => ({
  useNotification: () => ({ showNotification }),
}));

const mockStartRegistration = vi.fn();
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
  startRegistration: (...args: unknown[]) => mockStartRegistration(...args),
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

  it("registers a new passkey and stashes its credential id in localStorage", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockPost.mockImplementation((url: string) => {
      if (url === "/api/webauthn/register/options") {
        return Promise.resolve({ data: { challenge: "c" } });
      }
      return Promise.resolve({ data: { verified: true } });
    });
    mockStartRegistration.mockResolvedValue({ id: "cred-2" });

    const user = userEvent.setup();
    render(<AccountSettings />);
    await screen.findByText("iPhone");

    await user.click(screen.getByRole("button", { name: /add face id/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/api/webauthn/register/verify",
        expect.objectContaining({ id: "cred-2" }),
      ),
    );
    expect(localStorage.getItem("webauthnLastCredentialId")).toBe("cred-2");
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
});
