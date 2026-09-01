require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const dayjs = require("dayjs");
const path = require("path");

// Some local networks' default DNS resolver can't answer SRV queries
// (needed for mongodb+srv:// URIs); fall back to a public resolver.
dns.setServers(["8.8.8.8", ...dns.getServers()]);

async function main() {
  await mongoose.connect(process.env.MONGO_URI || "");
  const db = mongoose.connection.db;

  const loans = await db
    .collection("loans")
    .find(
      {},
      {
        projection: {
          _id: 0,
          caseNo: 1,
          tenure: 1,
          startDate: 1,
          ledgerBalance: 1,
        },
      }
    )
    .toArray();

  const scheduleStats = await db
    .collection("loanschedules")
    .aggregate([
      { $sort: { voucherDate: 1 } },
      {
        $group: {
          _id: "$caseNo",
          paid: { $sum: { $cond: [{ $eq: ["$status", "Paid"] }, 1, 0] } },
          due: { $sum: { $cond: [{ $eq: ["$status", "Due"] }, 1, 0] } },
          total: { $sum: 1 },
          emi: { $first: "$emi" },
          totalAmount: { $sum: "$emi" },
          paidAmount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Paid"] }, "$paidAmount", 0],
            },
          },
          dueAmount: {
            $sum: { $cond: [{ $eq: ["$status", "Due"] }, "$emi", 0] },
          },
        },
      },
    ])
    .toArray();

  const statsMap = new Map(scheduleStats.map((s) => [s._id, s]));

  const rows = loans
    .filter((l) => l.caseNo)
    .sort((a, b) => a.caseNo.localeCompare(b.caseNo))
    .map((l) => {
      const stats = statsMap.get(l.caseNo) || {
        paid: 0,
        due: 0,
        total: 0,
        emi: 0,
        totalAmount: 0,
        paidAmount: 0,
        dueAmount: 0,
      };
      return {
        "Case Number": l.caseNo,
        "Total Tenure": l.tenure ?? "N/A",
        "EMI Amount": stats.emi ?? 0,
        "Total Amount": Number(stats.totalAmount.toFixed(2)),
        "Installments Paid": stats.paid,
        "Paid Amount": Number(stats.paidAmount.toFixed(2)),
        "Installments Due": stats.due,
        "Due Amount": Number(stats.dueAmount.toFixed(2)),
        "Ledger Balance": l.ledgerBalance ?? 0,
        "Case Start Date": l.startDate
          ? dayjs(l.startDate).format("DD-MM-YYYY")
          : "N/A",
      };
    });

  console.log(`Total cases: ${rows.length}`);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Case Report");

  const outPath = path.join(__dirname, "..", "CaseInstallmentReport.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`Saved: ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
