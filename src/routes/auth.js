import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../prisma.js";
import validateRegister from "../validators/auth.validator.js";
import * as jwt from "jsonwebtoken";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

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

    const passwordHash = await bcrypt.hash(result.data.password, 12);

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
    // Handle duplicate email (unique constraint)
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

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
export default router;
