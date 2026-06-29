import mongoose from "mongoose";
import { User } from "../models/userModel";
import { connectDB } from "../config/db";

const registerUser = async () => {
  try {
    await connectDB();
    const userData = {
      name: "John Doe",
      email: "test@gmail.com",
      password: "test@123"
    };
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      console.log("User already exists with this email");
      process.exit(0);
    }
    const user = new User(userData);
    await user.save();
    console.log("User registered successfully!");
    console.log(`Name: ${user.name}`);
    console.log(`Email: ${user.email}`);
  } catch (error) {
    console.error("Error registering user:", error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};
registerUser();
