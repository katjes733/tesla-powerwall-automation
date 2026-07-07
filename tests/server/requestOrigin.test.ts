import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { getPublicOrigin } from "~/server/util/requestOrigin";

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
