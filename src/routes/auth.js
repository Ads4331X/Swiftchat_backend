import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../prisma.js";
import validateRegister, {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from "../validators/auth.validator.js";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { transporter } from "../transporter.js";
import rateLimit from "express-rate-limit";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    // gets the user details
    const { username, email, password, confirmPassword } = req.body;

    // check if user details are validate
    const result = validateRegister({
      username,
      email,
      password,
      confirmPassword,
    });

    if (result.error) {
      return res.status(400).json({
        error: result.error,
      });
    }

    // hash the password
    const passwordHash = await bcrypt.hash(result.data.password, 12);

    // creates a new user (regesters a user)
    const user = await prisma.user.create({
      data: {
        username: result.data.username,
        email: result.data.email,
        password_hash: passwordHash,
      },
    });

    return res.status(201).json({
      message: "Account created successfully",
      userId: user.id,
    });
  } catch (err) {
    // Handle duplicate username/email (unique constraints)
    if (err?.code === "P2002") {
      // Prisma 7 with adapter-pg nests the constraint fields here
      const fields =
        err.meta?.driverAdapterError?.cause?.constraint?.fields ||
        err.meta?.target ||
        [];
      if (fields.includes("username")) {
        return res.status(409).json({ error: "Username already taken" });
      }
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    // gets the user details for login
    const { email, password } = req.body;

    // check if the user details are empty
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // normalize the email by triming and converting to lowercase
    const normalizedEmail = email.trim().toLowerCase();

    // check if user email exists or not
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.warn(
        `[AUTH] Login failed: User not found for email '${normalizedEmail}'`,
      );
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // checks if the password matches or not ( it hashes the password and compares it with the hashed pasword in the db)
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      console.warn(
        `[AUTH] Login failed: Password mismatch for email '${normalizedEmail}'`,
      );
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // create a jwt token
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.status(200).json({
      message: "Login successful",
      token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const otpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 1, // 1 request per minute
  message: {
    error: "Please wait before requesting another OTP",
  },
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 attempts per window to prevent OTP brute-force
  message: {
    error: "Too many attempts. Please try again later.",
  },
});

router.post("/forgot-password", otpLimiter, async (req, res) => {
  try {
    // gets the user details and check if it is validate
    const { email } = req.body;
    const result = validateEmail(email);

    if (result.error) return res.status(400).json({ error: result.error });

    // check if user exists
    const user = await prisma.user.findUnique({
      where: { email: result.data },
      select: {
        id: true,
        email: true,
        username: true,
      },
    });

    // Anti-enumeration: always respond the same way whether or not the email
    // exists, so this endpoint can't be used to probe registered emails.
    if (!user) {
      return res.status(200).json({
        message:
          "If an account exists for this email, a reset code has been sent.",
      });
    }

    // generate a opt
    const otp = crypto
      .randomInt(0, 1000000)
      .toString()
      .padStart(6, "0")
      .toString();

    // hash the otp and creates a expire time limit 5min
    const hashOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // message to send in email
    const fullMessage = [
      `Hello ${user.username},`,
      "",
      "Your password reset code is:",
      otp,
      "",
      "This code expires in 5 minutes.",
      "If you didn't request this, you can safely ignore this email.",
      "",
      "Regards,",
      "Swiftchat",
    ].join("\n");

    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
        <h2 style="margin: 0 0 16px;">Hello ${user.username},</h2>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
          Your password reset code is:
        </p>
        <div style="background: #e6f4fe; border: 1px dashed #00a896; border-radius: 12px; padding: 16px; text-align: center; margin: 16px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #008378;">${otp}</span>
        </div>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.6; margin: 0 0 16px;">
          This code expires in <strong>5 minutes</strong>.
          If you didn't request this, you can safely ignore this email.
        </p>
        <p style="font-size: 13px; color: #6b7280; margin: 0;">Regards,<br/>Swiftchat</p>
      </div>
    `;

    const mailOptions = {
      from: process.env.NODEMAILER_GMAIL_EMAIL,
      to: user.email,
      subject: "Your Swiftchat Verification Code",
      text: fullMessage,
      html: htmlMessage,
    };

    // Send the email before storing the token so a failed email doesn't leave
    // an orphan (unusable) reset token behind.
    await transporter.sendMail(mailOptions);

    // Keep exactly one active token per user.
    await prisma.PasswordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.PasswordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashOtp,
        expiresAt: expiresAt,
      },
    });

    return res.status(200).json({ message: "Reset code sent" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-otp", verifyOtpLimiter, async (req, res) => {
  try {
    // gets the email and otp form user details
    const { email, otp } = req.body;

    // check if user exists
    const user = await prisma.user.findUnique({
      where: { email: email?.trim().toLowerCase() },
      select: { id: true },
    });

    // Anti-enumeration: same generic error for unknown email / bad code.
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // find the latest valid password reset token for the user
    const token = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    // check if the token is valid or not by comparing it with the hash otp
    const valid = token ? await bcrypt.compare(otp, token.tokenHash) : false;
    if (!valid) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Non-consuming pre-check: the token is only consumed in reset-password.
    return res.json({ valid: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset-password", verifyOtpLimiter, async (req, res) => {
  try {
    // gets the user details and check if its validate
    const { email, otp, newPassword, confirmNewPassword } = req.body;

    const emailResult = validateEmail(email);
    if (emailResult.error)
      return res.status(400).json({ error: emailResult.error });

    const passwordResult = validatePassword(newPassword);
    if (passwordResult.error)
      return res.status(400).json({ error: passwordResult.error });

    const matchResult = validatePasswordMatch(newPassword, confirmNewPassword);
    if (matchResult.error)
      return res.status(400).json({ error: matchResult.error });

    // check if user exists
    const user = await prisma.user.findUnique({
      where: { email: emailResult.data },
      select: { id: true },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // find the latest unused and non-expired password reset token and verify the OTP
    const token = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    // check if the token is valid or not by comparing it with the hash otp
    const valid = token ? await bcrypt.compare(otp, token.tokenHash) : false;
    if (!valid) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // hash the password
    const passwordHash = await bcrypt.hash(passwordResult.data, 12);

    // update the password and mark the reset token as used in a single transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password_hash: passwordHash },
      }),
      prisma.PasswordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
