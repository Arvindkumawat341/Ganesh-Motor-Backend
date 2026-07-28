/**
 * Script: Find fully-paid cases with no receipt/transaction uploaded
 *
 * "Paid case"    = all LoanSchedule installments for caseNo have status "Paid"
 * "No receipt"   = zero Transaction records exist for that caseNo
 *
 * Run: node scripts/find-paid-no-receipt.js
 */

const mongoose = require("mongoose");

const MONGO_URI =
  "mongodb+srv://maitriiinfotechsolutions_db_user:Maitrii3939@cluster0.rsadnsi.mongodb.net/";

// ── Schemas (inline, no TS compilation needed) ──────────────────────────────

const loanSchema = new mongoose.Schema({
  caseNo: String,
  name: String,
  loanAmount: Number,
  tenure: Number,
  startDate: Date,
  ledgerBalance: { type: Number, default: 0 },
});
const Loan = mongoose.model("Loan", loanSchema);

const loanScheduleSchema = new mongoose.Schema({
  caseNo: String,
  status: String,
  emi: Number,
  voucherDate: Date,
});
const LoanSchedule = mongoose.model("LoanSchedule", loanScheduleSchema);

const transactionSchema = new mongoose.Schema({
  caseNo: String,
  amount: Number,
  date: Date,
  paymentMode: String,
});
const Transaction = mongoose.model("Transaction", transactionSchema);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB\n");

  // 1. Get all unique caseNos that have at least one installment
  const allCaseNos = await LoanSchedule.distinct("caseNo");
  console.log(`Total cases with installments: ${allCaseNos.length}`);

  const paidNoReceipt = [];

  for (const caseNo of allCaseNos) {
    // 2. Check if any installment is still "Due" for this case
    const dueCount = await LoanSchedule.countDocuments({
      caseNo,
      status: "Due",
    });

    if (dueCount > 0) continue; // not fully paid

    // 3. Check if all installments are "Paid" (and at least 1 exists)
    const paidCount = await LoanSchedule.countDocuments({
      caseNo,
      status: "Paid",
    });

    if (paidCount === 0) continue; // no paid installments either (e.g., "Pending")

    // 4. Check if any transaction/receipt exists for this case
    const txnCount = await Transaction.countDocuments({ caseNo });

    if (txnCount === 0) {
      // Fully paid but no receipt uploaded
      const loan = await Loan.findOne({ caseNo }).lean();
      paidNoReceipt.push({
        caseNo,
        name: loan ? loan.name : "N/A",
        loanAmount: loan ? loan.loanAmount : "N/A",
        paidInstallments: paidCount,
        ledgerBalance: loan ? loan.ledgerBalance : "N/A",
      });
    }
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  console.log(
    `\n====== Paid Cases WITH NO Receipt Uploaded: ${paidNoReceipt.length} ======\n`
  );

  if (paidNoReceipt.length === 0) {
    console.log("None found — all paid cases have receipts.");
  } else {
    console.log(
      "CaseNo".padEnd(12) +
        "Name".padEnd(35) +
        "Loan Amount".padEnd(15) +
        "Paid EMIs".padEnd(12) +
        "Ledger Balance"
    );
    console.log("-".repeat(85));

    paidNoReceipt.forEach((c) => {
      console.log(
        String(c.caseNo).padEnd(12) +
          String(c.name).padEnd(35) +
          String(c.loanAmount).padEnd(15) +
          String(c.paidInstallments).padEnd(12) +
          String(c.ledgerBalance)
      );
    });
  }

  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
