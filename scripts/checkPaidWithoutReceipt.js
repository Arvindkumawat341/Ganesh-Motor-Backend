// Finds LoanSchedule installments marked "Paid" for a given due date, and
// checks whether the case actually has a Transaction (receipt) recorded near
// that date. If not, the installment was settled purely from ledgerBalance
// surplus carried over from an earlier payment — not a fresh receipt for
// this date. That's expected system behavior (ledger is a shared pool per
// case, FIFO-applied to due installments), not a bug — this script just
// makes it visible per case so it can be sanity-checked.
//
// Usage:
//   node scripts/checkPaidWithoutReceipt.js 20/08/2026
//   node scripts/checkPaidWithoutReceipt.js 20/08/2026 7   (±7 day window instead of default ±5)

require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");

dns.setServers(["8.8.8.8", ...dns.getServers()]);

function parseDDMMYYYY(str) {
  const match = String(str || "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const date = new Date(year, Number(month) - 1, Number(day));
  return isNaN(date.getTime()) ? null : date;
}

async function main() {
  const dateArg = process.argv[2];
  const windowDays = Number(process.argv[3]) || 5;

  const targetDate = parseDDMMYYYY(dateArg);
  if (!targetDate) {
    console.error("Usage: node scripts/checkPaidWithoutReceipt.js DD/MM/YYYY [windowDays]");
    process.exit(1);
  }

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  await mongoose.connect(process.env.MONGO_URI || "");
  const db = mongoose.connection.db;

  const schedules = await db
    .collection("loanschedules")
    .find({ voucherDate: { $gte: dayStart, $lte: dayEnd }, status: "Paid" })
    .toArray();

  console.log(`Found ${schedules.length} "Paid" installment(s) due on ${dateArg}.`);

  if (schedules.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const caseNos = [...new Set(schedules.map((s) => s.caseNo))];

  const loans = await db
    .collection("loans")
    .find({ caseNo: { $in: caseNos } }, { projection: { caseNo: 1, ledgerBalance: 1 } })
    .toArray();
  const loanMap = new Map(loans.map((l) => [l.caseNo, l]));

  // Cash-added transactions use `caseNo`; NACH-uploaded ones use `Transaction_Reference`.
  const transactions = await db
    .collection("transactions")
    .find({
      $or: [
        { caseNo: { $in: caseNos } },
        { Transaction_Reference: { $in: caseNos } },
      ],
    })
    .toArray();

  const txnsByCase = new Map();
  transactions.forEach((t) => {
    const key = t.caseNo || t.Transaction_Reference;
    if (!txnsByCase.has(key)) txnsByCase.set(key, []);
    const rawDate = t.Value_Date || t.date || t.VocharDate;
    txnsByCase.get(key).push({
      date: rawDate ? new Date(rawDate) : null,
      amount: t.Amount ?? t.amount ?? 0,
    });
  });

  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const rows = schedules
    .sort((a, b) => a.caseNo.localeCompare(b.caseNo))
    .map((s) => {
      const loan = loanMap.get(s.caseNo);
      const txns = txnsByCase.get(s.caseNo) || [];
      const nearby = txns
        .filter((t) => t.date && Math.abs(t.date.getTime() - dayStart.getTime()) <= windowMs)
        .sort((a, b) => Math.abs(a.date - dayStart) - Math.abs(b.date - dayStart));

      const hasNearbyReceipt = nearby.length > 0;

      return {
        "Case No": s.caseNo,
        "Voucher ID": s.voucherId || "",
        EMI: s.emi ?? 0,
        "Paid Amount": s.paidAmount ?? 0,
        "Ledger Balance Now": loan?.ledgerBalance ?? 0,
        [`Receipt within ±${windowDays}d?`]: hasNearbyReceipt ? "Yes" : "No",
        "Nearest Receipt Date": hasNearbyReceipt
          ? nearby[0].date.toLocaleDateString("en-GB")
          : "",
        Note: hasNearbyReceipt
          ? ""
          : "Settled from ledger balance carried over from an earlier payment",
      };
    });

  const withoutReceipt = rows.filter((r) => r.Note !== "");
  console.log(
    `${withoutReceipt.length} of ${rows.length} were settled with no receipt dated near ${dateArg} — carried over from ledger surplus.`
  );

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Paid Without Receipt");
  const outPath = path.join(
    __dirname,
    "..",
    `PaidCheck_${dateArg.replace(/\//g, "-")}.xlsx`
  );
  XLSX.writeFile(wb, outPath);
  console.log(`Saved: ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
