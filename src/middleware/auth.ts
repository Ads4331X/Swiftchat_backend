import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

interface AuthRequest extends Request {
  userId?: number;
}

export default function auth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (typeof decoded === "string" || !("userId" in decoded)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = Number(decoded.userId);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.userId = userId;

    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
