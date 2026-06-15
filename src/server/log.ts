import pino from "pino";
import path from "path";

export default function createLogger(env = Bun.env) {
  return pino(
    {
      level: env.LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string): { level: string } => ({ level: label }),
        bindings: (): Record<string, unknown> => ({}),
      },
      ...((env.LOG_PRETTY_PRINT ?? true) && {
        transport: {
          target: path.resolve("node_modules/pino-pretty"),
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
