import express from "express";
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

// Routes
app.use("/api", loanRoutes);
app.use("/api/auth", userloginroutes )
app.use("/api/verify", verifyRoutes )

export default app;
