import type { Request, Response, NextFunction } from "express";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  next();
}
