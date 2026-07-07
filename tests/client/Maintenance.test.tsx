/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const showNotification = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("~/client/components/auth/AuthContext", () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock("~/client/components/notification/NotificationContext", () => ({
  useNotification: () => ({ showNotification }),
}));

import Maintenance from "~/client/components/maintenance/Maintenance";

function mockStatus(overrides: Partial<Record<string, unknown>> = {}) {
  mockGet.mockResolvedValue({
    data: {
      success: true,
      data: {
        email: "user@example.com",
        hasToken: true,
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        ...overrides,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Maintenance", () => {
  it("loads and displays the refresh token status", async () => {
    mockStatus();
    render(<Maintenance />);

    expect(await screen.findByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
  });

  it("shows an error toast when the status fetch fails", async () => {
    mockGet.mockRejectedValue(new Error("network error"));
    render(<Maintenance />);

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        "Failed to load refresh token status",
        "error",
      ),
    );
  });

  it("opens a confirmation dialog when clicking Generate New Refresh Token", async () => {
    mockStatus({ hasToken: false, expiresAt: null });
    const user = userEvent.setup();
    render(<Maintenance />);

    await screen.findByText("user@example.com");
    await user.click(
      screen.getByRole("button", { name: "Generate New Refresh Token" }),
    );

    expect(
      screen.getByText("Regenerate Tesla Refresh Token?"),
    ).toBeInTheDocument();
  });

  it("starts the OAuth flow by opening a new tab with the authorize URL on confirm", async () => {
    mockStatus({ hasToken: false, expiresAt: null });
    mockPost.mockResolvedValue({
      data: {
        success: true,
        data: { authorizeUrl: "https://tesla.example.com/authorize" },
      },
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const user = userEvent.setup();

    render(<Maintenance />);
    await screen.findByText("user@example.com");
    await user.click(
      screen.getByRole("button", { name: "Generate New Refresh Token" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        "/api/maintenance/refresh-token/start",
      ),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://tesla.example.com/authorize",
      "_blank",
    );
  });

  it("shows an error toast when the popup is blocked", async () => {
    mockStatus({ hasToken: false, expiresAt: null });
    mockPost.mockResolvedValue({
      data: {
        success: true,
        data: { authorizeUrl: "https://tesla.example.com/authorize" },
      },
    });
    vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();

    render(<Maintenance />);
    await screen.findByText("user@example.com");
    await user.click(
      screen.getByRole("button", { name: "Generate New Refresh Token" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        "Please allow pop-ups for this site to continue.",
        "error",
      ),
    );
  });

  it("shows a success toast and refetches status on a postMessage success event", async () => {
    mockStatus();
    render(<Maintenance />);
    await screen.findByText("user@example.com");
    mockGet.mockClear();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { source: "tesla-oauth", status: "success" },
      }),
    );

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        "Refresh token regenerated successfully",
        "success",
      ),
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
  });

  it("ignores postMessage events from a different origin", async () => {
    mockStatus();
    render(<Maintenance />);
    await screen.findByText("user@example.com");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example.com",
        data: { source: "tesla-oauth", status: "success" },
      }),
    );

    expect(showNotification).not.toHaveBeenCalled();
  });

  it("maps a known error code to a readable message on a postMessage error event", async () => {
    mockStatus({ hasToken: false, expiresAt: null });
    render(<Maintenance />);
    await screen.findByText("user@example.com");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { source: "tesla-oauth", status: "error", code: "invalid_state" },
      }),
    );

    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        "This authorization link is no longer valid. Please try again.",
        "error",
      ),
    );
  });
});
