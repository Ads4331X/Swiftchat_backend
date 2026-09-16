import rateLimit from "express-rate-limit";

export const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 1, // 1 request per minute
  message: {
    error: "Please wait before requesting another OTP",
  },
});

export const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 attempts per window to prevent OTP brute-force
  message: {
    error: "Too many attempts. Please try again later.",
  },
});
