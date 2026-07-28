import { Request, Response } from "express";
import * as loanService from "../services/loanService";
import { Loan } from "../models/loanModel";
import { LoanSchedule } from "../models/LoanSchedule";
import csv from "csv-parser";
import {
  sendErrorResponse,
  sendSuccessResponse,
  STATUS_CODES,
} from "../helper";
import XLSX from "xlsx";
import Transaction from "../models/Transaction";
import { Readable } from "stream";

function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}

export const createLoan = async (req: Request, res: Response) => {
  try {
    const loan = await loanService.createLoan(req.body);
    sendSuccessResponse(
      res,
      loan,
      "Loan created successfully",
      STATUS_CODES.CREATED
    );
  } catch (error: any) {
    console.error("Error creating loan:", error);
    sendErrorResponse(res, error, STATUS_CODES.BAD_REQUEST);
  }
};

const parseContactNumbers = (raw: string): string[] => {
  const cleaned = (raw || "").replace(/[^0-9]/g, "");
  const numbers: string[] = [];
  for (let i = 0; i < cleaned.length; i += 10) {
    const chunk = cleaned.slice(i, i + 10);
    if (chunk.length >= 8 && chunk.length <= 10) {
      numbers.push(chunk);
    }
  }

  return numbers;
};

function parseRowToLoan(row: any, failed: any[]) {
  const contactNos = parseContactNumbers(String(row["contactNo"] || ""));
  const parsedRow = {
    caseNo: String(row["caseNo"] || "").trim(),
    name: String(row["name"] || "").trim(),
    address: String(row["address"] || "").trim(),
    ENGINENO: String(row["ENGINENO"] || "").trim(),
    CHASSISNO: String(row["CHASSISNO"] || "").trim(),
    umrnNo: String(row["umrnNo"] || "").trim(),
    contactNo: contactNos,
    loanAmount: Number(String(row["loanAmount"] || "").replace(/,/g, "")),
    tenure: Number(String(row["tenure"] || "").replace(/[^0-9]/g, "")),
    annualInterest: Number(String(row["annualInterest"] || "").replace(/[^0-9.]/g, "")),
    startDate: new Date(row["startDate"]),
    emiDate: new Date(row["emiDate"]),
  };

  const invalid = [
    !parsedRow.caseNo,
    !parsedRow.name,
    !Array.isArray(parsedRow.contactNo) || parsedRow.contactNo.length === 0,
    isNaN(parsedRow.loanAmount),
    isNaN(parsedRow.tenure),
    isNaN(parsedRow.annualInterest),
    !(parsedRow.startDate instanceof Date && !isNaN(parsedRow.startDate.getTime())),
    !(parsedRow.emiDate instanceof Date && !isNaN(parsedRow.emiDate.getTime())),
  ].some(Boolean);

  if (invalid) {
    failed.push({ caseNo: parsedRow.caseNo || row["Case No"], error: "Invalid or missing fields" });
    return null;
  }
  return parsedRow;
}

export const uploadLoansCSV = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return sendErrorResponse(res, { message: "File not uploaded" }, 400);
    }

    const ext = req.file.originalname.split(".").pop()?.toLowerCase();
    const loans: any[] = [];
    const failed: any[] = [];

    if (ext === "xlsx" || ext === "xls") {
      // Parse XLSX/XLS from buffer
      const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false });
      for (const row of rows) {
        const parsed = parseRowToLoan(row, failed);
        if (parsed) loans.push(parsed);
      }
    } else {
      // Parse CSV from buffer
      await new Promise<void>((resolve, reject) => {
        bufferToStream(req.file!.buffer)
          .pipe(csv())
          .on("data", (row) => {
            const parsed = parseRowToLoan(row, failed);
            if (parsed) loans.push(parsed);
          })
          .on("end", resolve)
          .on("error", reject);
      });
    }

    const inserted: any[] = [];
    for (const data of loans) {
      try {
        await loanService.createLoan(data);
        inserted.push({ caseNo: data.caseNo });
      } catch (err: any) {
        failed.push({ caseNo: data.caseNo, error: err?.message || "Unknown error" });
      }
    }

    sendSuccessResponse(res, { inserted, failed }, "File processed successfully", 200);
  } catch (error: any) {
    sendErrorResponse(res, error.message || "Internal Server Error", 500);
  }
};

export const uploadUmrnFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return sendErrorResponse(res, { message: "No file uploaded" }, 400);
    }

    const results: { caseNo: string; umrnNo: string }[] = [];
    bufferToStream(req.file.buffer)
      .pipe(csv())
      .on("data", (data) => {
        results.push({
          caseNo: String(data.caseNo)?.trim(),
          umrnNo: String(data["UMRN No"])?.trim(),
        });
      })
      .on("end", async () => {
        const summary = await loanService.processUmrnFile(results);
        sendSuccessResponse(res, summary, "File processed successfully", 200);
      })
      .on("error", (err) => {
        console.error("Error reading file:", err);
        sendErrorResponse(res, { message: "Error reading file" }, 500);
      });
  } catch (error: any) {
    console.error("Upload file error:", error);
    sendErrorResponse(res, error.message, 500);
  }
};

export const getLoanSchedule = async (req: Request, res: Response) => {
  try {
    const { caseNo } = req.params;

    const loan = await Loan.findOne({ caseNo });
    if (!loan) {
      return sendErrorResponse(
        res,
        { message: "Loan not found" },
        STATUS_CODES.NOT_FOUND
      );
    }

    const schedule = await LoanSchedule.find({ caseNo }).sort({ month: 1 });
    return sendSuccessResponse(
      res,
      { loan, schedule },
      "Loan schedule fetched successfully"
    );
  } catch (error: any) {
    console.error("Error fetching loan schedule:", error);
    return sendErrorResponse(res, error, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const filterLoans = async (req: Request, res: Response) => {
  try {
    const { caseNo, name, prefix } = req.query; // prefix => MG / MC etc.

    const loans = await loanService.filterLoans({
      caseNo: caseNo as string,
      name: name as string,
      prefix: prefix as string,
    });

    sendSuccessResponse(res, loans, "Loans filtered successfully");
  } catch (error: any) {
    console.error("Error filtering loans:", error);
    sendErrorResponse(res, error, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const getAllLoans = async (_req: Request, res: Response) => {
  try {
    const loans = await loanService.getAllLoans();
    sendSuccessResponse(res, loans, "All loans fetched successfully");
  } catch (error: any) {
    console.error("Error fetching loans:", error);
    sendErrorResponse(res, error, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const getPaidLoans = async (_req: Request, res: Response) => {
  try {
    const loans = await loanService.getPaidLoans();

    sendSuccessResponse(res, loans, "All loans fetched successfully");
  } catch (error: any) {
    console.error("Error fetching loans:", error);
    sendErrorResponse(res, error, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const getPrincipalDue = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    if (!date) {
      return sendErrorResponse(
        res,
        { message: "Date query parameter is required" },
        STATUS_CODES.BAD_REQUEST
      );
    }
    const principalDue = await loanService.getPrincipalOutstandingForLast30Days(
      new Date(date as string)
    );
    sendSuccessResponse(
      res,
      { principalDue },
      "Principal due fetched successfully"
    );
  } catch (error: any) {
    console.error("Error fetching principal due:", error);
    sendErrorResponse(
      res,
      error.message || "Internal Server Error",
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

export const filterLoanSchedule = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, caseNo } = req.query;

    if (!startDate || !endDate) {
      return sendErrorResponse(
        res,
        { message: "Start date and end date are required" },
        400
      );
    }

    const result = await loanService.filterLoanSchedule(
      startDate as string,
      endDate as string,
      caseNo as string | undefined
    );

    sendSuccessResponse(
      res,
      result,
      "Filtered loan schedules fetched successfully"
    );
  } catch (error: any) {
    console.error("Error filtering loan schedules:", error);
    sendErrorResponse(res, error, 500);
  }
};

export const downloadLoanCSV = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate, caseNo } = req.query;

    if (!startDate || !endDate) {
      sendErrorResponse(
        res,
        { message: "Start date and end date are required" },
        400
      );
      return;
    }

    const csv = await loanService.generateLoanCSV(
      startDate as string,
      endDate as string,
      caseNo as string
    );

    res.header("Content-Type", "text/csv");
    res.attachment("loan_schedule_export.csv");
    res.send(csv);
  } catch (error: any) {
    console.error("CSV Download Error:", error);
    sendErrorResponse(res, error, 500);
  }
};

export const uploadTransactions = async (req: Request, res: Response) => {
  try {
    if (!req.file?.buffer) {
      return sendErrorResponse(
        res,
        { message: "File is required" },
        STATUS_CODES.BAD_REQUEST
      );
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    await loanService.processTransactionData(data);

    sendSuccessResponse(
      res,
      {},
      "Transactions uploaded and saved successfully"
    );
  } catch (error: any) {
    console.error("Error processing file:", error);
    sendErrorResponse(
      res,
      error.message || "Internal Server Error",
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

export const getUploadedTransactions = async (req: Request, res: Response) => {
  try {
    const transactions = await Transaction.find().lean();

    const caseNos = transactions.map((t) => t.Transaction_Reference);
    const loans = await Loan.find({ caseNo: { $in: caseNos } }).lean();
    const schedules = await LoanSchedule.find({ caseNo: { $in: caseNos } })
      .sort({ voucherDate: 1 })
      .lean();

    const loanMap = new Map();
    loans.forEach((loan) => loanMap.set(loan.caseNo, loan));

    const scheduleMap = new Map();
    schedules.forEach((schedule) => {
      if (!scheduleMap.has(schedule.caseNo)) {
        scheduleMap.set(schedule.caseNo, []);
      }
      scheduleMap.get(schedule.caseNo).push(schedule);
    });

    const result = transactions.map((tx) => {
      const caseNo = tx.Transaction_Reference;
      return {
        transaction: tx,
        loan: loanMap.get(caseNo) || null,
        schedules: scheduleMap.get(caseNo) || [],
      };
    });

    sendSuccessResponse(res, result, "Transactions fetched successfully");
  } catch (error: any) {
    console.error("Error fetching transactions:", error);
    sendErrorResponse(
      res,
      error.message || "Internal Server Error",
      STATUS_CODES.INTERNAL_SERVER_ERROR
    );
  }
};

export const updateLedgerBalance = async (req: Request, res: Response) => {
  try {
    const { caseNo, amount, otherCharges, paymentMode, remarks } = req.body;

    if (!caseNo || typeof amount !== "number" || !paymentMode) {
      return sendErrorResponse(
        res,
        { message: "caseNo, amount, and paymentMode are required." },
        400
      );
    }

    const result = await loanService.addAmountToLedger(
      caseNo,
      amount,
      otherCharges,
      paymentMode,
      remarks
    );

    if (!result.success) {
      return sendErrorResponse(
        res,
        { message: result.message ?? "Unknown error" },
        404
      );
    }

    return sendSuccessResponse(
      res,
      { ledgerBalance: result.ledgerBalance },
      "Ledger updated and transaction logged.",
      200
    );
  } catch (error: any) {
    console.error("Error in ledger update:", error);
    return sendErrorResponse(
      res,
      error.message || "Internal Server Error",
      500
    );
  }
};

export const bulkLedgerUpload = async (req: Request, res: Response) => {
  try {
    const file = req.file;

    if (!file) {
      return sendErrorResponse(res, { message: "CSV file is required." }, 400);
    }

    const results: any[] = [];

    await new Promise<void>((resolve, reject) => {
      bufferToStream(file.buffer)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    let successCount = 0;
    let failureCount = 0;
    let failures: string[] = [];

    for (const record of results) {
      const caseNo = record.caseNo?.trim();
      const amount = parseFloat(record.amount);
      const otherCharges = parseFloat(record.otherCharges || "0");
      const remarks = record.remarks;

      if (!caseNo || isNaN(amount)) {
        failureCount++;
        failures.push(`Invalid data: ${JSON.stringify(record)}`);
        continue;
      }

      const result = await loanService.addAmountToLedger(
        caseNo,
        amount,
        otherCharges,
        "caseBulkuplode",
        remarks
      );

      if (result.success) successCount++;
      else {
        failureCount++;
        failures.push(`${caseNo}: ${result.message}`);
      }
    }

    return sendSuccessResponse(
      res,
      { successCount, failureCount, failures },
      "Bulk ledger upload processed.",
      200
    );
  } catch (error: any) {
    console.error("Bulk upload error:", error);
    return sendErrorResponse(
      res,
      error.message || "Internal server error",
      500
    );
  }
};

export const getInstallmentsByCaseNo = async (req: Request, res: Response) => {
  try {
    const { caseNo } = req.params;

    // Fetch loan + populated transactions
    const loan = await Loan.findOne({ caseNo }).populate("transactions");

    if (!loan) {
      return sendErrorResponse(
        res,
        { message: "Loan data not found for this case number" },
        STATUS_CODES.NOT_FOUND
      );
    }

    const installments = await LoanSchedule.find({ caseNo }).sort({
      voucherDate: 1,
    });

    if (!installments || installments.length === 0) {
      return sendErrorResponse(
        res,
        { message: "No installment data found for this case number" },
        STATUS_CODES.NOT_FOUND
      );
    }
    const {
      loanAmount = 0,
      annualInterest = 0,
      tenure = 0,
      startDate,
      transactions = [],
    } = loan;
    const r = annualInterest / 12 / 100;
    const EMI =
      (loanAmount * r * Math.pow(1 + r, tenure)) /
      (Math.pow(1 + r, tenure) - 1);

    const totalPayable = EMI * tenure;
    const annualInterestAmount = totalPayable - loanAmount;
    const stock = loanAmount + annualInterestAmount;
    const filteredInstallments = installments.filter(
      (inst) => inst.status === "Paid" || inst.status === "Due"
    );

    let merged: any[] = [];
    merged.push({
      type: "finance",
      date: startDate,
      narration: `Amount Financed Case No ${caseNo}`,
      stockOS: stock.toFixed(2),
      instDue: 0,
      received: 0,
      uiColor: "gray",
    });
    
    filteredInstallments.forEach((inst) => {
      const stockOSValue =
        Number(inst.principalDue || 0) +
        Number(inst.futureUnearnedInterestLoanSchedule || 0);

      merged.push({
        type: "installment",
        instId: inst._id,
        date: inst.voucherDate,
        narration: "EMI Installment",
        stockOS: stockOSValue.toFixed(2),
        instDue: Number(inst.emi || 0),
        received: 0,
        uiColor: "yellow",
      });
    });
    transactions.forEach((txn: any) => {
      merged.push({
        type: "txn",
        txnId: txn._id,
        date: txn.date,
        narration: txn.paymentMode,
        stockOS: stock.toFixed(2),
        instDue: 0,
        remarks: txn.remarks,
        received: Number(txn.amount || 0),
        uiColor: "blue",
      });
    });

    merged.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let runningBalance = 0;
    merged = merged.map((row) => {
      runningBalance =
        runningBalance + Number(row.received || 0) - Number(row.instDue || 0);

      return {
        ...row,
        balance: runningBalance.toFixed(2),
      };
    });

    return sendSuccessResponse(
      res,
      {
        caseNo,
        loanAmount,
        annualInterest,
        tenure,
        startDate,
        stock,
        totalInstallments: filteredInstallments.length,
        mergedList: merged,
      },
      "Merged list calculated successfully"
    );
  } catch (error: any) {
    console.error("Error:", error);
    return sendErrorResponse(res, error, STATUS_CODES.INTERNAL_SERVER_ERROR);
  }
};

export const deleteTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const result = await loanService.deleteTransaction(id);

    if (!result.success) {
      return sendErrorResponse(res, { message: result.message as string }, 404);
    }

    return sendSuccessResponse(
      res,
      {},
      "Transaction deleted and rolled back successfully.",
      200
    );
  } catch (error: any) {
    console.error("Error deleting transaction:", error);
    return sendErrorResponse(
      res,
      error.message || "Internal Server Error",
      500
    );
  }
};

export const editTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { amount, otherCharges, paymentMode, remarks } = req.body;

    const result = await loanService.editTransaction(id, {
      amount,
      otherCharges,
      paymentMode,
      remarks,
    });

    if (!result.success) {
      return sendErrorResponse(res, { message: result.message as string }, 404);
    }

    return sendSuccessResponse(
      res,
      { ledgerBalance: result.ledgerBalance },
      "Transaction edited and updated successfully.",
      200
    );
  } catch (error: any) {
    console.error("Error editing transaction:", error);
    return sendErrorResponse(
      res,
      error.message || "Internal Server Error",
      500
    );
  }
};
