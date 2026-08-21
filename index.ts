import dotenv from "dotenv";
import app from "./src/app";
import { connectDB } from "./src/config/db";
import cron from "node-cron";
import { processDueInstallments } from "./src/services/loanService";

dotenv.config();

connectDB().then(() => {
  // Run once on startup to catch any missed promotions
  processDueInstallments().then((r) =>
    console.log(`Startup cron: processed=${r.processed} skipped=${r.skipped}`)
  );

  // Run every day at midnight
  cron.schedule("0 0 * * *", async () => {
    console.log("Cron running:", new Date().toISOString());
    const r = await processDueInstallments();
    console.log(`Cron done: processed=${r.processed} skipped=${r.skipped}`);
  });
});

const port = process.env.PORT || 6000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
// Bulk uploads (thousands of rows) can take a while; don't let the socket
// get cut off mid-request.
server.setTimeout(10 * 60 * 1000);

export default app;
