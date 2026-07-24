import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Request } from "express";
import {
  getPublicOrigin,
  getWebauthnConfig,
} from "~/server/util/requestOrigin";

function makeReq(headers: Record<string, string | undefined>): Request {
  return {
    protocol: "https",
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe("getPublicOrigin", () => {
  it("prefers X-Forwarded-Host over Host when present", () => {
    const req = makeReq({
      "x-forwarded-host": "powerwall.katjes733.com",
      host: "192.168.2.108:3001",
    });
    expect(getPublicOrigin(req)).toBe("https://powerwall.katjes733.com");
  });

  it("falls back to Host when X-Forwarded-Host is absent", () => {
    const req = makeReq({ host: "localhost:3001" });
    expect(getPublicOrigin(req)).toBe("https://localhost:3001");
  });

  it("uses only the first value when X-Forwarded-Host has multiple comma-separated hosts", () => {
    const req = makeReq({
      "x-forwarded-host": "powerwall.katjes733.com, internal-proxy.local",
      host: "192.168.2.108:3001",
    });
    expect(getPublicOrigin(req)).toBe("https://powerwall.katjes733.com");
  });
});

describe("getWebauthnConfig", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_EXPECTED_ORIGINS;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects an IP-address rpID", () => {
    process.env.WEBAUTHN_RP_ID = "192.168.2.108";
    process.env.WEBAUTHN_EXPECTED_ORIGINS = "https://192.168.2.108";
    expect(() => getWebauthnConfig()).toThrow(/registrable domain/i);
  });

  it("defaults to localhost/https://localhost:5173 in development", () => {
    process.env.NODE_ENV = "development";
    expect(getWebauthnConfig()).toEqual({
      rpID: "localhost",
      expectedOrigin: ["https://localhost:5173"],
    });
  });

  it("throws in production when WEBAUTHN_RP_ID is unset", () => {
    process.env.NODE_ENV = "production";
    expect(() => getWebauthnConfig()).toThrow(/WEBAUTHN_RP_ID/);
  });

  it("reads a shared parent domain and multiple expected origins from env", () => {
    process.env.NODE_ENV = "production";
    process.env.WEBAUTHN_RP_ID = "katjes733.com";
    process.env.WEBAUTHN_EXPECTED_ORIGINS =
      "https://tpa.katjes733.com, https://powerwall.katjes733.com";
    expect(getWebauthnConfig()).toEqual({
      rpID: "katjes733.com",
      expectedOrigin: [
        "https://tpa.katjes733.com",
        "https://powerwall.katjes733.com",
      ],
    });
  });
});
