require("dotenv").config();
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");

async function main() {
  await mongoose.connect(process.env.MONGO_URI || "");

  const Loan = mongoose.model(
    "Loan",
    new mongoose.Schema({ caseNo: String }, { strict: false })
  );

  const loans = await Loan.find({}, { caseNo: 1, _id: 0 }).lean();

  const rows = loans
    .filter((l) => l.caseNo)
    .map((l, i) => ({ "S.No": i + 1, "Case Number": l.caseNo }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Case Numbers");

  const outPath = path.join(__dirname, "..", "CaseNumbers.xlsx");
  XLSX.writeFile(wb, outPath);

  console.log(`Total: ${rows.length}`);
  console.log(`Saved: ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
