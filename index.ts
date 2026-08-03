import dotenv from "dotenv";
import app from "./src/app";
import { connectDB } from "./src/config/db";

dotenv.config();

connectDB();

const port = process.env.PORT || 6000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
