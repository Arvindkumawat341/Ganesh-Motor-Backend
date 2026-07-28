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

app.get("/api/debug", async (req: any, res: any) => {
  const uri = process.env.MONGO_URI;
  const state = mongoose.connection.readyState;
  if (!uri) { res.json({ error: "MONGO_URI not set in env", state }); return; }
  try {
    if (state < 1) await mongoose.connect(uri);
    res.json({ ok: true, state: mongoose.connection.readyState, uri: uri.replace(/:([^:@]+)@/, ":***@") });
  } catch (err: any) {
    res.json({ error: err.message, state, uri: uri.replace(/:([^:@]+)@/, ":***@") });
  }
});

// Routes
app.use("/api", loanRoutes);
app.use("/api/auth", userloginroutes )
app.use("/api/verify", verifyRoutes )

export default app;
