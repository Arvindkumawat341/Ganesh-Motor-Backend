import express from "express";
import mongoose from "mongoose";
import loanRoutes from "./routes/loanRoutes";
import userloginroutes from "./routes/userRoutes"
import verifyRoutes from "./routes/verifyRoutes"
import cors from "cors";
const app = express();
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors());

app.get("/", (req, res) => {
  res.send("Backend is running! 🚀");
});

// Ensure DB connected before every API request
app.use("/api", async (_req: any, res: any, next: any) => {
  if (mongoose.connection.readyState >= 1) return next();
  try {
    await mongoose.connect(process.env.MONGO_URI || "", {
      serverSelectionTimeoutMS: 30000,
    });
    next();
  } catch (err: any) {
    console.error("MongoDB connection failed:", err.message);
    res.status(503).json({ success: false, message: "Database connection failed" });
  }
});

// Routes
app.use("/api", loanRoutes);
app.use("/api/auth", userloginroutes );
app.use("/api/verify", verifyRoutes );

export default app;
