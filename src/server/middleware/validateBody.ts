import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // express.json() only populates req.body when a matching Content-Type
    // header is present; a request sent with no body at all (e.g. an axios
    // POST with no data argument) leaves req.body as undefined rather than
    // {}. A schema whose fields are all optional should still accept that as
    // "nothing was sent", not reject it purely because the top-level value
    // isn't a plain object.
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
