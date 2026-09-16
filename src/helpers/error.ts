import { AppError } from "../errors/AppError.js";
import { Response } from "express";

export function handleError(err: unknown, res: Response): Response {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  console.error(err);

  return res.status(500).json({
    error: "Internal server error",
  });
}
