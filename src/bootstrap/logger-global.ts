import createLogger from "~/log";

const logger = createLogger();

Object.defineProperty(globalThis, "logger", {
  value: logger,
  writable: false,
  enumerable: false,
});

export {};
