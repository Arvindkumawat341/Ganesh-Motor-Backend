import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "";

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db!;

  // 1. Delete all transactions
  const txnResult = await db.collection("transactions").deleteMany({});
  console.log(`Deleted ${txnResult.deletedCount} transactions`);

  // 2. Reset all loan schedules → Due, paidAmount = 0
  const schedResult = await db.collection("loanschedules").updateMany(
    {},
    { $set: { status: "Due", paidAmount: 0 } }
  );
  console.log(`Reset ${schedResult.modifiedCount} loan schedules to Due`);

  // 3. For each loan: recalculate futureUnearnedInterest + principalOutstands from schedules, ledgerBalance = 0
  const loans = await db.collection("loans").find({}).toArray();
  console.log(`Processing ${loans.length} loans...`);

  for (const loan of loans) {
    const caseNo = loan.caseNo;

    const schedules = await db
      .collection("loanschedules")
      .find({ caseNo })
      .toArray();

    const totalInterest = schedules.reduce(
      (sum: number, s: any) => sum + (Number(s.interestAmt) || 0),
      0
    );
    const totalPrincipal = schedules.reduce(
      (sum: number, s: any) => sum + (Number(s.principalReduction) || 0),
      0
    );

    await db.collection("loans").updateOne(
      { caseNo },
      {
        $set: {
          ledgerBalance: 0,
          futureUnearnedInterest: totalInterest,
          principalOutstands: totalPrincipal,
        },
      }
    );

    console.log(
      `  ${caseNo}: interest=${totalInterest.toFixed(2)} principal=${totalPrincipal.toFixed(2)} ledger=0`
    );
  }

  console.log("\nDone. All transactions deleted, all EMIs reset to Due.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
