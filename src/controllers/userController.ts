import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/userModel";

export const registerUser = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
       res.status(400).json({ message: "User already exists" });return
    }

    // Create new user
    const user = new User({ name, email, password });
    await user.save();

    res.status(201).json({ message: "User registered successfully", user: { name: user.name, email: user.email } });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const loginUser = async (req: Request, res: Response) => {
  try {
    console.log("LOGIN HIT — body:", req.body);
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    console.log("USER FOUND:", user ? user.email : "null");
    if (!user) {
       res.status(400).json({ message: "Invalid email or password" });
       return
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    console.log("PASSWORD VALID:", isPasswordValid);
    if (!isPasswordValid) {
       res.status(400).json({ message: "Invalid email or password" });return
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: { name: user.name, email: user.email }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const verifyPassword = async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
       res.status(401).json({ message: "No token provided" });return
    }

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const user = await User.findById(decoded.userId);

    if (!user) {
       res.status(404).json({ message: "User not found" });return
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
       res.status(400).json({ message: "Incorrect password" });return
    }

    res.status(200).json({ message: "Password verified successfully" });
  } catch (error) {
    console.error("Password verification error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
