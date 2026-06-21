import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "~/server/util/redis";
import type { Request } from "express";

function redisStore(prefix: string) {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redis.call(args[0], ...args.slice(1)) as Promise<any>,
  });
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
  store: redisStore("rl:login:"),
  passOnStoreError: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts, try again later",
  },
});

export const sendCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  keyGenerator: (req: Request) =>
    req.body?.email ?? ipKeyGenerator(req.ip ?? "unknown"),
  store: redisStore("rl:send-code:"),
  passOnStoreError: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many code requests, try again later",
  },
});

export const verifyCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req: Request) =>
    req.body?.email ?? ipKeyGenerator(req.ip ?? "unknown"),
  store: redisStore("rl:verify-code:"),
  passOnStoreError: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts, try again later",
  },
});
