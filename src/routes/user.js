import * as express from "express";
import prisma from "../prisma.js";
import auth from "../middleware/auth.middleware.js";
import {
  validateEmail,
  validateUsername,
  validatePassword,
  validatePasswordMatch,
} from "../validators/auth.validator.js";
import bcrypt from "bcryptjs";

const router = express.Router();

router.get("/user-details", auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        username: true,
        email: true,
        created_at: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/update-user-info", auth, async (req, res) => {
  try {
    const { username, email } = req.body;

    const usernameResult = validateUsername(username);
    if (usernameResult.error) {
      return res.status(400).json({ error: usernameResult.error });
    }

    const emailResult = validateEmail(email);
    if (emailResult.error) {
      return res.status(400).json({ error: emailResult.error });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: {
        username: usernameResult.data,
        email: emailResult.data,
      },
      select: { id: true, username: true, email: true },
    });

    return res.json(updatedUser);
  } catch (err) {
    if (err?.code === "P2002") {
      const field = err.meta?.target?.[0]; // e.g. "username" or "email"
      if (field === "username") {
        return res.status(409).json({ error: "Username already taken" });
      }
      return res.status(409).json({ error: "Email already in use" });
    }
    if (err?.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/verify-password", auth, async (req, res) => {
  try {
    const { currentPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { password_hash: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ verify: false });
    }

    return res.status(200).json({ verify: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { password_hash: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentMatch = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!currentMatch) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newPasswordValidate = validatePassword(newPassword);
    if (newPasswordValidate.error) {
      return res.status(400).json({ error: newPasswordValidate.error });
    }

    const isMatch = validatePasswordMatch(newPassword, confirmNewPassword);
    if (isMatch.error) {
      return res.status(400).json({ error: isMatch.error });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: req.userId },
      data: { password_hash: passwordHash },
    });

    return res.status(200).json({ message: "Password changed successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
