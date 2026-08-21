import dotenv from "dotenv";
import mongoose from "mongoose";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import * as loanService from "../src/services/loanService";

dotenv.config();

function parseDDMMYYYY(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value;
  }
  const str = String(value ?? "").trim();
  const match = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return undefined;
  const [, day, month, rawYear] = match;
  const year =
    rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const date = new Date(year, Number(month) - 1, Number(day));
  return isNaN(date.getTime()) ? undefined : date;
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx ts-node scripts/bulkLedgerUploadCLI.ts <path-to-excel-or-csv>");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI || "");
  console.log("Connected to MongoDB");

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "" });

  console.log(`Read ${rows.length} rows from ${path.basename(filePath)}`);

  let successCount = 0;
  let failureCount = 0;
  const failures: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const record = rows[i];
    const caseNo = String(record.caseNo || "").trim();
    const amount = parseFloat(record.amount);
    const otherCharges = parseFloat(record.otherCharges || "0");
    const remarks = record.remarks;
    const paymentMode = String(record.paymentMode || "").trim() || "Cash";
    const date = record.date ? parseDDMMYYYY(record.date) : undefined;

    if (!caseNo || isNaN(amount)) {
      failureCount++;
      failures.push(`Row ${i + 2}: Invalid data: ${JSON.stringify(record)}`);
      continue;
    }

    try {
      const result = await loanService.addAmountToLedger(
        caseNo,
        amount,
        otherCharges,
        paymentMode,
        remarks,
        date
      );

      if (result.success) successCount++;
      else {
        failureCount++;
        failures.push(`Row ${i + 2} (${caseNo}): ${result.message}`);
      }
    } catch (err: any) {
      failureCount++;
      failures.push(`Row ${i + 2} (${caseNo}): ${err.message}`);
    }

    if ((i + 1) % 200 === 0 || i === rows.length - 1) {
      console.log(`Processed ${i + 1}/${rows.length} — success: ${successCount}, failed: ${failureCount}`);
    }
  }

  console.log("\n=== Done ===");
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failureCount}`);

  if (failures.length > 0) {
    const reportPath = path.join(__dirname, "..", "bulk-ledger-upload-failures.txt");
    fs.writeFileSync(reportPath, failures.join("\n"), "utf-8");
    console.log(`Failure details written to: ${reportPath}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
