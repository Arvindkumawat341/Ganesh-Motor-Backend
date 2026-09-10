import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

// Some local networks' default DNS resolver can't answer SRV queries
// (needed for mongodb+srv:// URIs); fall back to a public resolver.
dns.setServers(["8.8.8.8", ...dns.getServers()]);

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(process.env.MONGO_URI || "");
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
    throw err;
  }
};

