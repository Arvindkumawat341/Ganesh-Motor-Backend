import dotenv from "dotenv";
import app from "./src/app";
import { connectDB } from "./src/config/db";

dotenv.config();

connectDB();

const port = process.env.PORT || 6000;
app.listen(port, () => {
<<<<<<< HEAD
  console.log(`Server running on port ${port}`);
=======
  console.log(`Server running on http://localhost:${port}`);
>>>>>>> 2d09e33e1f07181e7561c9c6e9a32b09bd8db8d5
});

export default app;
