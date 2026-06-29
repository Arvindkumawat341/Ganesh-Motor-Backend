import express from "express";
import {  verifyPassword } from "../controllers/userController";


const router = express.Router();

// POST /api/auth/verify-password
router.post("/password", verifyPassword);

export default router;
