import pino from "pino";

export default function createLogger(
  env: Record<string, string | undefined> = process.env,
) {
  const prettyPrint =
    env.LOG_PRETTY_PRINT !== undefined
      ? env.LOG_PRETTY_PRINT === "true"
      : env.NODE_ENV !== "production";

  return pino(
    {
      level: env.LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string): { level: string } => ({ level: label }),
        bindings: (): Record<string, unknown> => ({}),
      },
      ...(prettyPrint && {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            levelFirst: true,
            translateTime: "UTC:mm/dd/yyyy, h:MM:ss TT Z",
          },
        },
      }),
    },
    pino.destination(1),
  );
}
