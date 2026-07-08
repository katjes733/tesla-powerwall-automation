/* eslint-disable no-unused-vars */
import type { Actor } from "~/server/util/actor";

export {};

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}
