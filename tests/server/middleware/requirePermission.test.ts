import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import {
  requirePermission,
  requireSiteScope,
} from "~/server/middleware/requirePermission";
import type { Actor } from "~/server/util/actor";

function makeReq(actor?: Actor, extra: Partial<Request> = {}): Request {
  return { actor, body: {}, query: {}, ...extra } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function readActor(overrides: Partial<Actor> = {}): Actor {
  return {
    loginEmail: "reader@example.com",
    source: "delegate",
    accountEmail: "owner@example.com",
    profile: "read",
    siteIds: "*",
    ...overrides,
  };
}

describe("requirePermission", () => {
  it("401s when req.actor is missing", () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();
    requirePermission("schedule.access")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when the actor's profile resolves the action to read", () => {
    const req = makeReq(readActor());
    const res = makeRes();
    const next = vi.fn();
    requirePermission("schedule.delete")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when the actor's profile resolves the action to none", () => {
    const req = makeReq(readActor());
    const res = makeRes();
    const next = vi.fn();
    requirePermission("maintenance.access")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when the actor's profile resolves the action to write", () => {
    const req = makeReq(readActor());
    const res = makeRes();
    const next = vi.fn();
    requirePermission("schedule.access")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows a write-profile actor to perform a mutating action", () => {
    const req = makeReq(readActor({ profile: "write" }));
    const res = makeRes();
    const next = vi.fn();
    requirePermission("schedule.delete")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("requireSiteScope", () => {
  it("401s when req.actor is missing", () => {
    const req = makeReq(undefined, { body: { siteId: "site-1" } });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "siteId" })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes any site when the actor has wildcard site access", () => {
    const req = makeReq(readActor({ siteIds: "*" }), {
      body: { siteId: "any-site" },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "siteId" })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("403s when the requested site (body, singular) isn't in the actor's scope", () => {
    const req = makeReq(readActor({ siteIds: ["site-1"] }), {
      body: { siteId: "site-2" },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "siteId" })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when the requested site (body, singular) is in scope", () => {
    const req = makeReq(readActor({ siteIds: ["site-1", "site-2"] }), {
      body: { siteId: "site-2" },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "siteId" })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("403s when any id in a requested array (body, plural) is out of scope", () => {
    const req = makeReq(readActor({ siteIds: ["site-1", "site-2"] }), {
      body: { site_ids: ["site-1", "site-3"] },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "site_ids" })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when every id in a requested array (body, plural) is in scope", () => {
    const req = makeReq(readActor({ siteIds: ["site-1", "site-2"] }), {
      body: { site_ids: ["site-1", "site-2"] },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "site_ids" })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("403s when the requested site (query) isn't in the actor's scope", () => {
    const req = makeReq(readActor({ siteIds: ["site-1"] }), {
      query: { siteId: "site-2" },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ queryKey: "siteId" })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("passes when no site id is present in the request at all", () => {
    const req = makeReq(readActor({ siteIds: ["site-1"] }), { body: {} });
    const res = makeRes();
    const next = vi.fn();
    requireSiteScope({ bodyKey: "siteId" })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
