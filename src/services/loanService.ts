import mongoose from "mongoose";
import { Loan, ILoan } from "../models/loanModel";
import { LoanSchedule } from "../models/LoanSchedule";
import { Parser } from "json2csv";
import { v4 as uuidv4 } from "uuid";
import Transaction from "../models/Transaction";

export const createLoan = async (loanData: ILoan): Promise<ILoan> => {
  const existing = await Loan.findOne({ caseNo: loanData.caseNo });
  if (existing) {
    throw new Error("Case number already exists");
  }
  const tempLoan = new Loan(loanData);
  const scheduleData = generateLoanSchedule(tempLoan);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureSchedules = scheduleData.filter(
    (item) => new Date(item.voucherDate) >= today
  );
  const futureUnearnedInterest = futureSchedules.reduce(
    (acc, item) => acc + item.interestAmt,
    0
  );
  const paidPrincipal = scheduleData
    .filter((item) => new Date(item.voucherDate) < today)
    .reduce((sum, item) => sum + item.principalReduction, 0);
  const principalOutstands = Math.round(loanData.loanAmount - paidPrincipal); 
  const loan = new Loan({
    ...loanData,
    principalOutstands,
    futureUnearnedInterest,
  });
  const savedLoan = await loan.save();
  const insertedSchedules = await LoanSchedule.insertMany(scheduleData);
  const scheduleIds = insertedSchedules.map((doc) => doc._id);
  savedLoan.loanScheduleIds = scheduleIds.map((id) => id.toString());
  await savedLoan.save();
  return savedLoan;
};

export const generateLoanSchedule = (loan: any) => {
  const monthlyInterestRate = loan.annualInterest / 12 / 100;
  const emi =
    (loan.loanAmount *
      monthlyInterestRate *
      Math.pow(1 + monthlyInterestRate, loan.tenure)) /
    (Math.pow(1 + monthlyInterestRate, loan.tenure) - 1);

  let balance = loan.loanAmount;
  const tempInterestList: number[] = [];
  let tempBalance = loan.loanAmount;

  for (let i = 1; i <= loan.tenure; i++) {
    const iAmt = tempBalance * monthlyInterestRate;
    const pAmt = emi - iAmt;
    tempBalance -= pAmt;
    tempInterestList.push(Math.round(iAmt));
  }

  const totalFutureInterest = tempInterestList.reduce((a, b) => a + b, 0);

  let remainingInterest = totalFutureInterest;

  const schedule = [];
  let currentDate = new Date(loan.emiDate);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let month = 1; month <= loan.tenure; month++) {
    const interestAmt = balance * monthlyInterestRate;
    const principalReduction = emi - interestAmt;
    balance -= principalReduction;
    remainingInterest -= Math.round(interestAmt);

    const dueDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate()
    );
    dueDate.setHours(0, 0, 0, 0);

    let status = "Pending";
    if (dueDate < today) status = "Paid";
    else if (dueDate.getTime() === today.getTime()) status = "Due";

    schedule.push({
      caseNo: loan.caseNo,
      voucherId: `${loan.caseNo}/${String(month).padStart(3, "0")}`,
      status,
      voucherDate: dueDate,
      emi: Math.round(emi),

      interestAmt: Math.round(interestAmt),
      principalReduction: Math.round(principalReduction),
      principalDue: balance > 0 ? Math.round(balance) : 0,
      futureUnearnedInterestLoanSchedule:
        remainingInterest > 0 ? Math.round(remainingInterest) : 0,
    });
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  return schedule;
};


export const processUmrnFile = async (
  rows: { caseNo: string; umrnNo: string }[]
) => {
  let updatedCount = 0;
  let replacedCount = 0;
  let notFound: string[] = [];

  for (const row of rows) {
    const { caseNo, umrnNo } = row;
    if (!caseNo || !umrnNo) {
      continue;
    }

    const loan = await Loan.findOne({ caseNo: String(caseNo).trim() });

    if (loan) {
      const alreadyExists = !!loan.umrnNo;

      loan.umrnNo = umrnNo;
      await loan.save();
      updatedCount++;

      if (alreadyExists) {
        replacedCount++;
      }
    } else {
      notFound.push(caseNo);
    }
  }

  return {
    totalRows: rows.length,
    updatedCount,
    replacedCount,
    notFoundCount: notFound.length,
    notFoundCases: notFound,
  };
};
export const getAllLoans = async (): Promise<ILoan[]> => {
  const caseStatus = await LoanSchedule.aggregate([
    {
      $group: {
        _id: "$caseNo",
        statuses: { $addToSet: "$status" }
      }
    },
    {
      $project: {
        caseNo: "$_id",
        isFullyPaid: { $setEquals: ["$statuses", ["Paid"]] }
      }
    }
  ]);
  const pendingCaseNos = caseStatus
    .filter(c => !c.isFullyPaid) 
    .map(c => c.caseNo);
  return Loan.find({ caseNo: { $in: pendingCaseNos } });
};

export const getPaidLoans = async (): Promise<ILoan[]> => {
  const caseStatus = await LoanSchedule.aggregate([
    {
      $group: {
        _id: "$caseNo",
        statuses: { $addToSet: "$status" }
      }
    },
    {
      $project: {
        caseNo: "$_id",
        isFullyPaid: { $setEquals: ["$statuses", ["Paid"]] } 
      }
    }
  ]);

  const paidCaseNos = caseStatus
    .filter(c => c.isFullyPaid) 
    .map(c => c.caseNo);

 

  return Loan.find({ caseNo: { $in: paidCaseNos } });
};


interface LoanFilter {
  caseNo?: string;
  name?: string;
  prefix?: string;
}

export const filterLoans = async (filters: LoanFilter): Promise<ILoan[]> => {
  const query: any = {};

  if (filters.caseNo) {
    // Partial match (case-insensitive)
    query.caseNo = { $regex: filters.caseNo, $options: "i" };
  }

  if (filters.name) {
    query.name = { $regex: filters.name, $options: "i" };
  }

  if (filters.prefix) {
    // Prefix match: caseNo starting with given prefix (e.g. MG, MC)
    query.caseNo = { $regex: `^${filters.prefix}`, $options: "i" };
  }

  return await Loan.find(query);
};

export const getPrincipalOutstandingForLast30Days = async (
  date: Date
): Promise<number> => {
  const endDate = new Date(date);
  endDate.setHours(0, 0, 0, 0);

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 30);

  const result = await LoanSchedule.aggregate([
    {
      $match: {
        voucherDate: {
          $gte: startDate,
          $lt: endDate,
        },
      },
    },
    {
      $group: {
        _id: null,
        totalPrincipalDue: { $sum: "$principalDue" },
      },
    },
  ]);

  return result[0]?.totalPrincipalDue || 0;
};


export const filterLoanSchedule = async (
  startDate: string,
  endDate: string,
  caseNo?: string
) => {
  const filter: { [key: string]: any } = {
    "loanSchedules.voucherDate": {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };

  // CaseNo prefix filter (e.g., MG..., MC...)
  if (caseNo) {
    filter["caseNo"] = { $regex: `^${caseNo}`, $options: "i" };
  }

  const result = await Loan.aggregate([
    {
      $lookup: {
        from: "loanschedules",
        localField: "loanScheduleIds",
        foreignField: "_id",
        as: "loanSchedules",
      },
    },
    { $unwind: "$loanSchedules" },
    { $match: filter },
    { $sort: { "loanSchedules.voucherDate": 1 } },
    {
      $project: {
        caseNo: 1,
        name: 1,
        address: 1,
        contactNo: 1,
        loanAmount: 1,
        tenure: 1,
        annualInterest: 1,
        startDate: 1,
        emiDate: 1,
        umrnNo: 1,
        "loanSchedules.voucherId": 1,
        "loanSchedules.voucherDate": 1,
        "loanSchedules.emi": 1,
        "loanSchedules.interestAmt": 1,
        "loanSchedules.principalReduction": 1,
        "loanSchedules.principalDue": 1,
        "loanSchedules.status": 1,
      },
    },
  ]);

  return result;
};

export const generateLoanCSV = async (
  startDate: string,
  endDate: string,
  caseNo?: string
): Promise<string> => {
  const matchFilter: any = {
    "loanSchedules.voucherDate": {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };
  if (caseNo) {
    const escaped = caseNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matchFilter.caseNo = { $regex: `^${escaped}`, $options: "i" };
  }
  const loans = await Loan.aggregate([
    {
      $lookup: {
        from: "loanschedules",
        localField: "loanScheduleIds",
        foreignField: "_id",
        as: "loanSchedules",
      },
    },
    { $unwind: "$loanSchedules" },
    { $match: matchFilter },
    {
      $project: {
        _id: 0,
        caseNo: 1,
        umrnNo: 1,
        "loanSchedules.voucherDate": 1,
        "loanSchedules.emi": 1,
        "loanSchedules.interestAmt": 1,
        "loanSchedules.principalReduction": 1,
      },
    },
  ]);

  const formattedData = loans.map((loan) => ({
    voucherDate: new Date(loan.loanSchedules.voucherDate).toLocaleDateString(),
    caseNo: loan.caseNo,
    emi: loan.loanSchedules.emi,
    interestAmount: loan.loanSchedules.interestAmt ?? 0,
    principalReduction: loan.loanSchedules.principalReduction ?? 0,
    umrnNo: loan.umrnNo || "",
    accountNo: "99998899988",
  }));

  const fields = ["voucherDate", "caseNo", "emi", "interestAmount", "principalReduction", "umrnNo", "accountNo"];
  const json2csvParser = new Parser({ fields });
  return json2csvParser.parse(formattedData);
};

export const processTransactionData = async (rows: any[]) => {
  const currentUploadDate = new Date();

  for (const row of rows) {
    const Status = row["Status"];
    const UMRN = row["UMRN"];
    const name = row["Beneficiary_Account_Holder_Name"];
    const amount = Number(row["Amount"]);
    const reference = row["Transaction_Reference"];
    const VocharId = uuidv4();
    const narration = `${reference}_${name}_${UMRN}`;
    const paymentMode = "NACH";
    const valueDate = row["Value_Date"];
    const caseNo = reference;

    // Prepare transaction object
    const transaction = {
      UMRN,
      Beneficiary_Account_Holder_Name: name,
      amount,
      Transaction_Reference: reference,
      VocharId,
      narration,
      paymentMode,
      Status,
      Value_Date: valueDate,
      VocharDate: currentUploadDate,
      caseNo
    };

    // Step 1: Create Transaction
    const createdTxn = await Transaction.create(transaction);

    // Step 2: Check loan
    const loan = await Loan.findOne({ caseNo });

    if (loan) {
      // Step 3: Push transaction._id into loan.transactions[]  
      loan.transactions = loan.transactions || [];
      loan.transactions.push(createdTxn._id as mongoose.Types.ObjectId);

      // Step 4: Increase ledgerBalance only if Status = Completed
      if (Status === "Completed") {
        loan.ledgerBalance = (loan.ledgerBalance || 0) + amount;
      }

      // Save
      await loan.save();
    }
  }
};


export const processDueInstallments = async (): Promise<{ processed: number; skipped: number }> => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Promote Pending → Due for all installments whose date has arrived
  await LoanSchedule.updateMany(
    { status: "Pending", voucherDate: { $lte: today } },
    { $set: { status: "Due" } }
  );

  // Now fetch all Due installments (oldest first)
  const activeSchedules = await LoanSchedule.find({
    status: "Due",
    voucherDate: { $lte: today },
  }).sort({ voucherDate: 1 });

  if (activeSchedules.length === 0) return { processed: 0, skipped: 0 };

  // Batch load all loans in one query — no N+1
  const caseNos = [...new Set(activeSchedules.map((s) => s.caseNo))];
  const loans = await Loan.find({ caseNo: { $in: caseNos } });
  const loanMap = new Map(loans.map((l) => [l.caseNo, l]));

  let processed = 0;
  let skipped = 0;

  for (const schedule of activeSchedules) {
    const loan = loanMap.get(schedule.caseNo as string);
    const totalEMI = schedule.emi ?? 0;

    if (!loan || (loan.ledgerBalance ?? 0) < totalEMI) {
      skipped++;
      continue;
    }

    const interestToDeduct = schedule.interestAmt ?? 0;
    const principalToDeduct = schedule.principalReduction ?? 0;

    loan.futureUnearnedInterest = Math.max(0, (loan.futureUnearnedInterest ?? 0) - interestToDeduct);
    loan.principalOutstands = Math.max(0, (loan.principalOutstands ?? 0) - principalToDeduct);
    loan.ledgerBalance = (loan.ledgerBalance ?? 0) - totalEMI;

    schedule.status = "Paid";
    schedule.paidAmount = totalEMI;

    await loan.save();
    await schedule.save();
    processed++;
  }

  return { processed, skipped };
};

export const addAmountToLedger = async (
  caseNo: string,
  amount: number,
  otherCharges: number = 0,
  paymentMode: string,
  remarks?: string
): Promise<{ success: boolean; ledgerBalance?: number; message?: string }> => {

  const loan = await Loan.findOne({ caseNo });

  if (!loan) {
    return { success: false, message: "Loan not found for provided caseNo." };
  }

  loan.ledgerBalance = (loan.ledgerBalance || 0) + amount;
  await loan.save();

  const transaction = await Transaction.create({
    caseNo,
    amount,
    otherCharges,
    paymentMode,
    remarks,
  });
  loan.transactions = loan.transactions || [];
  loan.transactions.push(transaction._id as mongoose.Types.ObjectId);
  await loan.save();

  // Process due installments for this case immediately after payment
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dueSchedules = await LoanSchedule.find({
    caseNo,
    status: "Due",
    voucherDate: { $lte: today },
  }).sort({ voucherDate: 1 });

  const updatedLoan = await Loan.findOne({ caseNo });
  if (updatedLoan) {
    for (const schedule of dueSchedules) {
      const emi = schedule.emi ?? 0;
      if ((updatedLoan.ledgerBalance ?? 0) < emi) break;
      const interest = schedule.interestAmt ?? 0;
      const principal = schedule.principalReduction ?? 0;
      updatedLoan.ledgerBalance = (updatedLoan.ledgerBalance ?? 0) - emi;
      updatedLoan.futureUnearnedInterest = Math.max(0, (updatedLoan.futureUnearnedInterest ?? 0) - interest);
      updatedLoan.principalOutstands = Math.max(0, (updatedLoan.principalOutstands ?? 0) - principal);
      schedule.status = "Paid";
      schedule.paidAmount = emi;
      await schedule.save();
    }
    await updatedLoan.save();
  }

  return { success: true, ledgerBalance: updatedLoan?.ledgerBalance ?? loan.ledgerBalance };
};

// Helper function to rollback EMIs for a loan by amount
const rollbackEmis = async (loan: any, amountToRollback: number) => {
  const paidSchedules = await LoanSchedule.find({ caseNo: loan.caseNo, status: "Paid" }).sort({ voucherDate: -1 });

  let remainingRollback = amountToRollback;

  for (const schedule of paidSchedules) {
    if (remainingRollback <= 0) break;

    const emi = schedule.emi ?? 0;
    if (remainingRollback >= emi) {
      // Rollback this EMI
      loan.ledgerBalance = (loan.ledgerBalance || 0) + emi;
      loan.principalOutstands = (loan.principalOutstands || 0) + (schedule.principalReduction ?? 0);
      loan.futureUnearnedInterest = (loan.futureUnearnedInterest || 0) + (schedule.interestAmt ?? 0);
      schedule.status = "Due";
      schedule.paidAmount = 0;
      remainingRollback -= emi;
      await schedule.save();
    }
  }

  await loan.save();
};

// Helper function to apply cron logic for a single loan
const applyCronForLoan = async (loan: any) => {
  const activeSchedules = await LoanSchedule.find({ caseNo: loan.caseNo, status: "Due" }).sort({ voucherDate: 1 });

  for (const schedule of activeSchedules) {
    if ((loan.ledgerBalance ?? 0) < (schedule.emi ?? 0)) continue;

    const interestToDeduct = schedule.interestAmt ?? 0;
    const principalToDeduct = schedule.principalReduction ?? 0;
    const totalEMI = schedule.emi ?? 0;

    if (loan.futureUnearnedInterest >= interestToDeduct) {
      loan.futureUnearnedInterest -= interestToDeduct;
    } else {
      continue;
    }
    if (loan.principalOutstands >= principalToDeduct) {
      loan.principalOutstands -= principalToDeduct;
    } else {
      continue;
    }
    loan.ledgerBalance = (loan.ledgerBalance ?? 0) - totalEMI;

    schedule.status = "Paid";
    schedule.paidAmount = totalEMI;

    await loan.save();
    await schedule.save();
  }
};

export const deleteTransaction = async (transactionId: string): Promise<{ success: boolean; message?: string }> => {
  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    return { success: false, message: "Transaction not found." };
  }

  const loan = await Loan.findOne({ caseNo: transaction.caseNo });
  if (!loan) {
    return { success: false, message: "Loan not found." };
  }

  // Subtract amount from ledger
  loan.ledgerBalance = (loan.ledgerBalance || 0) - (transaction.amount || 0);

  // Remove transaction from loan
  loan.transactions = loan.transactions?.filter(id => !id.equals(transaction._id as mongoose.Types.ObjectId)) || [];

  // Rollback EMIs
  await rollbackEmis(loan, transaction.amount || 0);

  // Delete transaction
  await Transaction.findByIdAndDelete(transactionId);

  // Re-process remaining Due installments with current ledger balance
  const caseNo = transaction.caseNo;
  if (caseNo) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const updatedLoan = await Loan.findOne({ caseNo });
    const dueSchedules = await LoanSchedule.find({ caseNo, status: "Due", voucherDate: { $lte: today } }).sort({ voucherDate: 1 });
    if (updatedLoan) {
      for (const schedule of dueSchedules) {
        const emi = schedule.emi ?? 0;
        if ((updatedLoan.ledgerBalance ?? 0) < emi) break;
        updatedLoan.ledgerBalance = (updatedLoan.ledgerBalance ?? 0) - emi;
        updatedLoan.futureUnearnedInterest = Math.max(0, (updatedLoan.futureUnearnedInterest ?? 0) - (schedule.interestAmt ?? 0));
        updatedLoan.principalOutstands = Math.max(0, (updatedLoan.principalOutstands ?? 0) - (schedule.principalReduction ?? 0));
        schedule.status = "Paid";
        schedule.paidAmount = emi;
        await schedule.save();
      }
      await updatedLoan.save();
    }
  }

  return { success: true };
};

export const editTransaction = async (
  transactionId: string,
  updates: { amount?: number; otherCharges?: number; paymentMode?: string; remarks?: string }
): Promise<{ success: boolean; ledgerBalance?: number; message?: string }> => {
  const transaction = await Transaction.findById(transactionId);
  if (!transaction) {
    return { success: false, message: "Transaction not found." };
  }

  const loan = await Loan.findOne({ caseNo: transaction.caseNo });
  if (!loan) {
    return { success: false, message: "Loan not found." };
  }

  // Full rollback of old transaction
  loan.ledgerBalance = (loan.ledgerBalance || 0) - (transaction.amount || 0);
  await rollbackEmis(loan, transaction.amount || 0);

  // Update transaction
  if (updates.amount !== undefined) transaction.amount = updates.amount;
  if (updates.otherCharges !== undefined) transaction.otherCharges = updates.otherCharges;
  if (updates.paymentMode !== undefined) transaction.paymentMode = updates.paymentMode;
  if (updates.remarks !== undefined) transaction.remarks = updates.remarks;
  await transaction.save();

  // Apply new amount
  loan.ledgerBalance = (loan.ledgerBalance || 0) + (transaction.amount || 0);
  await loan.save();

  // Run cron logic
  await applyCronForLoan(loan);

  return { success: true, ledgerBalance: loan.ledgerBalance };
};


