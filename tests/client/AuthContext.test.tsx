/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      interceptors: { response: { use: vi.fn(), eject: vi.fn() } },
    }),
  },
}));

const mockStartAuthentication = vi.fn();
const mockPlatformAuthenticatorIsAvailable = vi.fn();
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (...args: unknown[]) => mockStartAuthentication(...args),
  platformAuthenticatorIsAvailable: (...args: unknown[]) =>
    mockPlatformAuthenticatorIsAvailable(...args),
}));

import { AuthProvider } from "~/client/components/auth/AuthContext";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function renderAndSettleMount() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <div />
      </AuthProvider>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(mockGet).toHaveBeenCalledWith("/api/session/me", expect.anything()),
  );
  // Let the mount effect's own attemptSilentPasskeyLogin (also triggered on
  // an unauthenticated mount) settle before the test clears mocks, so it
  // doesn't leak into assertions about the visibilitychange-triggered path.
  await new Promise((resolve) => setTimeout(resolve, 0));
  mockGet.mockClear();
  mockPost.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockGet.mockRejectedValue({ response: { status: 401 } });
  setVisibility("visible");
});

describe("AuthContext auto sign-in on refocus", () => {
  it("attempts a silent passkey login on a hidden→visible transition when unauthenticated, supported, and previously enrolled on this device", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
    mockPost.mockResolvedValue({ data: { challenge: "c" } });
    mockStartAuthentication.mockImplementation(
      () => new Promise(() => {}), // never resolves — we only assert it was attempted
    );

    // Set the marker only after mount settles — the mount effect's own
    // attemptSilentPasskeyLogin call (also triggered on an unauthenticated
    // mount) would otherwise hang forever awaiting the never-resolving
    // startAuthentication() above, leaving the in-flight guard stuck and
    // making the visibilitychange-triggered attempt below a false negative.
    await renderAndSettleMount();
    localStorage.setItem("webauthnLastCredentialId", "cred-1");

    setVisibility("hidden");
    setVisibility("visible");

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/api/webauthn/login/options",
        {},
        expect.anything(),
      ),
    );
  });

  it("does not attempt a silent passkey login when this device never enrolled one", async () => {
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);

    await renderAndSettleMount();

    setVisibility("hidden");
    setVisibility("visible");

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        "/api/session/me",
        expect.anything(),
      ),
    );
    expect(mockPost).not.toHaveBeenCalledWith(
      "/api/webauthn/login/options",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not attempt a silent passkey login when no platform authenticator is available", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(false);

    await renderAndSettleMount();

    setVisibility("hidden");
    setVisibility("visible");

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        "/api/session/me",
        expect.anything(),
      ),
    );
    expect(mockPost).not.toHaveBeenCalledWith(
      "/api/webauthn/login/options",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not attempt a silent passkey login without a hidden→visible transition (e.g. an explicit logout while still focused)", async () => {
    localStorage.setItem("webauthnLastCredentialId", "cred-1");
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);

    await renderAndSettleMount();

    // Visible → visible again with no intervening "hidden" is not a real
    // refocus transition.
    setVisibility("visible");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockPost).not.toHaveBeenCalledWith(
      "/api/webauthn/login/options",
      expect.anything(),
      expect.anything(),
    );
  });
});
