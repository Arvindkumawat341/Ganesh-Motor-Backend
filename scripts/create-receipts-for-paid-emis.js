/**
 * Script: Create transaction/receipt records for all paid EMIs with no receipt
 *
 * For each case where installments are "Paid" but no transactions exist:
 *   → Create one Transaction per paid EMI
 *   → Date  = EMI voucherDate
 *   → Amount = EMI amount
 *   → PaymentMode = "Bank Transfer"
 *   → Push transaction IDs into loan.transactions[]
 *
 * Usage:
 *   node scripts/create-receipts-for-paid-emis.js          ← dry run (safe, no DB write)
 *   node scripts/create-receipts-for-paid-emis.js --commit  ← actually saves to DB
 */

const mongoose = require("mongoose");

const MONGO_URI =
  "mongodb+srv://maitriiinfotechsolutions_db_user:Maitrii3939@cluster0.rsadnsi.mongodb.net/";

const DRY_RUN = !process.argv.includes("--commit");

// ── Schemas ──────────────────────────────────────────────────────────────────

const loanSchema = new mongoose.Schema({
  caseNo: String,
  name: String,
  loanAmount: Number,
  tenure: Number,
  startDate: Date,
  ledgerBalance: { type: Number, default: 0 },
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Transaction" }],
});
const Loan = mongoose.model("Loan", loanSchema);

const loanScheduleSchema = new mongoose.Schema({
  caseNo: String,
  status: String,
  emi: Number,
  voucherDate: Date,
  paidAmount: { type: Number, default: 0 },
});
const LoanSchedule = mongoose.model("LoanSchedule", loanScheduleSchema);

const transactionSchema = new mongoose.Schema(
  {
    caseNo: String,
    amount: Number,
    otherCharges: { type: Number, default: 0 },
    paymentMode: { type: String, default: "NACH", required: true },
    remarks: String,
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
const Transaction = mongoose.model("Transaction", transactionSchema);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");
  console.log(DRY_RUN ? "\n*** DRY RUN — no DB writes ***\n" : "\n*** COMMIT MODE — writing to DB ***\n");

  // 1. Get all cases with at least one paid installment
  const allCaseNos = await LoanSchedule.distinct("caseNo", { status: "Paid" });
  console.log(`Cases with paid EMIs: ${allCaseNos.length}`);

  // 2. Filter: keep only cases with ZERO existing transactions
  const casesNoReceipt = [];
  for (const caseNo of allCaseNos) {
    const txnCount = await Transaction.countDocuments({ caseNo });
    if (txnCount === 0) casesNoReceipt.push(caseNo);
  }
  console.log(`Cases with paid EMIs but NO receipt: ${casesNoReceipt.length}\n`);

  let totalTxnsCreated = 0;
  let totalCasesProcessed = 0;
  const errors = [];

  for (const caseNo of casesNoReceipt) {
    // Get all paid installments sorted by date
    const paidInstallments = await LoanSchedule.find({
      caseNo,
      status: "Paid",
    }).sort({ voucherDate: 1 });

    if (paidInstallments.length === 0) continue;

    const loan = await Loan.findOne({ caseNo });
    if (!loan) {
      errors.push(`${caseNo}: loan not found`);
      continue;
    }

    const newTxnIds = [];
    const txnSummary = [];

    for (const inst of paidInstallments) {
      const amount = Number(inst.emi || inst.paidAmount || 0);
      const date = inst.voucherDate;

      if (!amount || !date) {
        errors.push(`${caseNo}: installment missing emi/date — skipped`);
        continue;
      }

      if (!DRY_RUN) {
        const txn = await Transaction.create({
          caseNo,
          amount,
          paymentMode: "Bank Transfer",
          date,
          remarks: "Auto-generated receipt for paid EMI",
        });
        newTxnIds.push(txn._id);
      }

      txnSummary.push({ date: date.toISOString().split("T")[0], amount });
      totalTxnsCreated++;
    }

    if (!DRY_RUN && newTxnIds.length > 0) {
      loan.transactions = loan.transactions || [];
      loan.transactions.push(...newTxnIds);
      await loan.save();
    }

    totalCasesProcessed++;
    console.log(
      `${DRY_RUN ? "[DRY]" : "[DONE]"} ${caseNo} — ${loan.name} — ${paidInstallments.length} receipts`
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log(`Cases processed : ${totalCasesProcessed}`);
  console.log(`Receipts ${DRY_RUN ? "to be created" : "created"}: ${totalTxnsCreated}`);
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach((e) => console.log("  !", e));
  }
  if (DRY_RUN) {
    console.log("\nTo actually create receipts, run:");
    console.log("  node scripts/create-receipts-for-paid-emis.js --commit");
  }
  console.log("========================================\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
