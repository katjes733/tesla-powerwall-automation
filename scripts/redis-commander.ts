const { REDIS_HOST = "localhost", REDIS_PORT = "6379", REDIS_PASSWORD } =
  process.env;

const args = [
  "redis-commander",
  "--redis-host",
  REDIS_HOST,
  "--redis-port",
  REDIS_PORT,
];
if (REDIS_PASSWORD) args.push("--redis-password", REDIS_PASSWORD);

Bun.spawn(args, { stdio: ["inherit", "inherit", "inherit"] });
