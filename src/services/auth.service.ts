import bcrypt from "bcryptjs";
import {
  ForgotPassword,
  Login,
  Register,
  ResetPassword,
  VerifyOTP,
} from "../types/auth.type.js";
import validateRegister, {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from "../validators/auth.validator.js";
import prisma from "../prisma.js";
import jwt from "jsonwebtoken";
import { AppError } from "../errors/AppError.js";
import crypto from "node:crypto";
import { transporter } from "../transporter.js";
import { createOtpHtml, createOtpText } from "../utils/emailTemplates.js";

export async function register({
  username,
  email,
  password,
  confirmPassword,
}: Register) {
  // check if user details are validate
  const result = validateRegister({
    username,
    email,
    password,
    confirmPassword,
  });

  if (result.error) {
    throw new AppError(result.error as string, 400);
  }
  // hash the password
  const passwordHash = await bcrypt.hash(result.data!.password!, 12);

  // creates a new user (regesters a user)
  const user = await prisma.user.create({
    data: {
      username: result.data!.username!,
      email: result.data!.email!,
      password_hash: passwordHash,
    },
  });

  return {
    userId: user.id,
  };
}

export async function login({ email, password }: Login) {
  // normalize the email by triming and converting to lowercase
  const normalizedEmail = email.trim().toLowerCase();

  // check if user email exists or not
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) throw new AppError("Invalid email or password", 401);

  // checks if the password matches or not ( it hashes the password and compares it with the hashed pasword in the db)
  const passwordMatch = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatch) throw new AppError("Invalid email or password", 401);

  const token = jwt.sign(
    {
      userId: user.id,
    },
    process.env.JWT_SECRET as string,
  );

  return {
    token,
  };
}

export async function forgotPassword({ email }: ForgotPassword) {
  // check if email is validate
  const result = validateEmail(email);

  if (result.error) throw new AppError(result.error, 400);

  // check if user exists
  const user = await prisma.user.findUnique({
    where: { email: result.data! },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });

  // Anti-enumeration: always respond the same way whether or not the email
  // exists, so this endpoint can't be used to probe registered emails.
  if (!user) return "Reset Code Sent";

  // generate a opt
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");

  // hash the otp and creates a expire time limit 5min
  const hashOtp = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Send the email before storing the token so a failed email doesn't leave
  // an orphan (unusable) reset token behind.
  await transporter.sendMail({
    from: process.env.NODEMAILER_GMAIL_EMAIL,
    to: user.email,
    subject: "Your Swiftchat Verification Code",
    text: createOtpText({ username: user.username, otp }),
    html: createOtpHtml({ username: user.username, otp }),
  });
  // Keep exactly one active token per user.
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashOtp,
      expiresAt: expiresAt,
    },
  });

  return "Reset Code Sent";
}

export async function verifyOtp({ email, otp }: VerifyOTP) {
  // check if user exists
  const user = await prisma.user.findUnique({
    where: { email: email?.trim().toLowerCase() },
    select: { id: true },
  });

  // Anti-enumeration: same generic error for unknown email / bad code.
  if (!user) {
    throw new AppError("Invalid or expired code", 400);
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
    throw new AppError("Invalid or expired code", 400);
  }

  // Non-consuming pre-check: the token is only consumed in reset-password.
  return { valid: true };
}

export async function resetPassword({
  email,
  otp,
  newPassword,
  confirmNewPassword,
}: ResetPassword) {
  const emailResult = validateEmail(email);
  if (emailResult.error) throw new AppError(emailResult.error, 400);

  const passwordResult = validatePassword(newPassword);
  if (passwordResult.error) throw new AppError(passwordResult.error, 400);

  const matchResult = validatePasswordMatch(newPassword, confirmNewPassword);
  if (matchResult.error) throw new AppError(matchResult.error, 400);

  // check if user exists
  const user = await prisma.user.findUnique({
    where: { email: emailResult.data! },
    select: { id: true },
  });

  if (!user) throw new AppError("Invalid or expired code", 400);

  // find the latest unused and non-expired password reset token and verify the OTP
  const token = await prisma.passwordResetToken.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!token) {
    throw new AppError("Invalid or expired code", 400);
  }
  // check if the token is valid or not by comparing it with the hash otp
  const valid = await bcrypt.compare(otp, token.tokenHash);
  if (!valid) throw new AppError("Invalid or expired code", 400);

  // hash the password
  const passwordHash = await bcrypt.hash(passwordResult.data!, 12);

  // update the password and mark the reset token as used in a single transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password_hash: passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { message: "Password reset successfully" };
}
