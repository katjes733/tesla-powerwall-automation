import Redis from "ioredis";

export const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
  commandTimeout: 3000,
});

redis.on("error", () => {
  // Suppressed — callers wrap commands in try/catch and fall back gracefully.
});
