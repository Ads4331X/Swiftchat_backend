import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { otpLimiter, verifyOtpLimiter } from "../middleware/rateLimit.js";
const router = Router();

router.post("/register", authController.register);

router.post("/login", authController.login);

router.post("/forgot-password", otpLimiter, authController.forgotPassword);

router.post("/verify-otp", verifyOtpLimiter, authController.verifyOtp);

router.post("/reset-password", verifyOtpLimiter, authController.resetPassword);

export default router;
