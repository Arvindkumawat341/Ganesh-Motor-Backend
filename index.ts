import dotenv from "dotenv";
import app from "./src/app";
import { connectDB } from "./src/config/db";

dotenv.config();

const port = process.env.PORT || 6000;


connectDB();


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
