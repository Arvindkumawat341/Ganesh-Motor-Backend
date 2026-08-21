require("dotenv").config();
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");

async function main() {
  await mongoose.connect(process.env.MONGO_URI || "");
  const db = mongoose.connection.db;

  const allLoans = await db
    .collection("loans")
    .find({}, { projection: { caseNo: 1, _id: 0 } })
    .toArray();
  const allCaseNos = allLoans.map((l) => l.caseNo).filter(Boolean);

  const paidCaseNos = await db.collection("transactions").distinct("caseNo");
  const paidSet = new Set(paidCaseNos.filter(Boolean));

  const withPayment = allCaseNos.filter((c) => paidSet.has(c));
  const withoutPayment = allCaseNos.filter((c) => !paidSet.has(c));

  console.log(`Total unique cases: ${allCaseNos.length}`);
  console.log(`Cases WITH payment: ${withPayment.length}`);
  console.log(`Cases WITHOUT payment: ${withoutPayment.length}`);

  const wb = XLSX.utils.book_new();

  const wsWith = XLSX.utils.json_to_sheet(
    withPayment.map((c, i) => ({ "S.No": i + 1, "Case Number": c }))
  );
  XLSX.utils.book_append_sheet(wb, wsWith, "With Payment");

  const wsWithout = XLSX.utils.json_to_sheet(
    withoutPayment.map((c, i) => ({ "S.No": i + 1, "Case Number": c }))
  );
  XLSX.utils.book_append_sheet(wb, wsWithout, "Without Payment");

  const outPath = path.join(__dirname, "..", "PaymentVsNoPayment.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`Saved: ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
