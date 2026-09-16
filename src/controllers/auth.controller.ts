import { Request, Response } from "express";
import * as authService from "../services/auth.service.js";
import { handleError } from "../helpers/error.js";

export async function register(req: Request, res: Response) {
  try {
    const { username, email, password, confirmPassword } = req.body;

    const result = await authService.register({
      username,
      email,
      password,
      confirmPassword,
    });

    return res.status(201).json({
      message: "Account created successfully",
      userId: result.userId,
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const fields =
        err.meta?.driverAdapterError?.cause?.constraint?.fields ||
        err.meta?.target ||
        [];

      if (fields.includes("username")) {
        return res.status(409).json({
          error: "Username already taken",
        });
      }

      return res.status(409).json({
        error: "Email already registered",
      });
    }

    return handleError(err, res);
  }
}
export async function login(req: Request, res: Response) {
  try {
    // gets the user details for login
    const { email, password } = req.body;

    // check if the user details are empty
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await authService.login({ email, password });

    return res
      .status(200)
      .json({ token: result.token, message: "Login successful" });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;

    const result = await authService.forgotPassword({ email });

    return res.status(200).json({ message: result });
  } catch (err) {
    return handleError(err, res);
  }
}

export async function verifyOtp(req: Request, res: Response) {
  try {
    const { email, otp } = req.body;

    const result = await authService.verifyOtp({ email, otp });

    return res.json(result);
  } catch (err) {
    return handleError(err, res);
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    // gets the user details and check if its validate
    const { email, otp, newPassword, confirmNewPassword } = req.body;

    const result = await authService.resetPassword({
      email,
      otp,
      newPassword,
      confirmNewPassword,
    });

    return res.json({ message: result.message });
  } catch (err) {
    return handleError(err, res);
  }
}
