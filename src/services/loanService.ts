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
  // Nothing has actually been paid yet at case creation, even if the EMI
  // start date is backdated (those installments are marked "Due", not
  // "Paid" — see generateLoanSchedule) — so the full tenure's interest is
  // still unearned and the full loan amount is still outstanding.
  const futureUnearnedInterest = scheduleData.reduce(
    (acc, item) => acc + item.interestAmt,
    0
  );
  const principalOutstands = Math.round(loanData.loanAmount);
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
    if (dueDate <= today) status = "Due";

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
        isFullyPaid: { $setEquals: ["$statuses", ["Paid"]] },
        // No "Pending" rows left means the full tenure has already run its
        // course — that's an overdue/expired case, not one still on track.
        hasPending: { $in: ["Pending", "$statuses"] },
      }
    }
  ]);
  const pendingCaseNos = caseStatus
    .filter(c => !c.isFullyPaid && c.hasPending)
    .map(c => c.caseNo);
  // A foreclosed case's schedule is never a pure {"Paid"} set (the closed-
  // out rows are "Foreclosed"), so it already lands here — filter it out,
  // it belongs in the dedicated Foreclosed tab instead.
  const loans = await Loan.find({ caseNo: { $in: pendingCaseNos } });
  return loans.filter((loan) => loan.status !== "foreclosed");
};

// A case whose tenure has fully run out (no "Pending" — i.e. future —
// installments left) but still has unpaid "Due" ones: the borrower stopped
// paying before finishing the loan instead of foreclosing it.
export const getExpiredLoans = async (): Promise<any[]> => {
  const caseStatus = await LoanSchedule.aggregate([
    { $group: { _id: "$caseNo", statuses: { $addToSet: "$status" } } },
    {
      $project: {
        caseNo: "$_id",
        hasPending: { $in: ["Pending", "$statuses"] },
        hasDue: { $in: ["Due", "$statuses"] },
      },
    },
  ]);
  const expiredCaseNos = caseStatus
    .filter((c) => !c.hasPending && c.hasDue)
    .map((c) => c.caseNo);
  const loans = await Loan.find({ caseNo: { $in: expiredCaseNos } });
  const eligible = loans.filter((loan) => loan.status !== "foreclosed");

  // How many EMIs are sitting unpaid, and for how much — the whole point of
  // this tab is spotting how overdue a case has gone.
  const caseNos = eligible.map((l) => l.caseNo);
  const dueStats = await LoanSchedule.aggregate([
    { $match: { caseNo: { $in: caseNos }, status: "Due" } },
    { $group: { _id: "$caseNo", dueCount: { $sum: 1 }, dueAmount: { $sum: "$emi" } } },
  ]);
  const statsMap = new Map(dueStats.map((s) => [s._id, s]));

  return eligible.map((loan) => {
    const stats = statsMap.get(loan.caseNo) || { dueCount: 0, dueAmount: 0 };
    return {
      ...loan.toObject(),
      dueCount: stats.dueCount ?? 0,
      dueAmount: stats.dueAmount ?? 0,
    };
  });
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

  const loans = await Loan.find({ caseNo: { $in: paidCaseNos } });
  return loans.filter((loan) => loan.status !== "foreclosed");
};


export const getForeclosedLoans = async (): Promise<ILoan[]> => {
  return Loan.find({ status: "foreclosed" });
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

interface LedgerFilter {
  status?: "pending" | "paid" | "foreclosed" | "expired";
  caseNo?: string;
  name?: string;
  prefix?: string;
}

export const getLedgerLoans = async (
  filters: LedgerFilter
): Promise<any[]> => {
  // The Foreclosed/Expired tabs list every matching case, not just ones
  // sitting on a leftover ledger balance — neither status touches
  // ledgerBalance, so most of them would be filtered out by the
  // ledgerBalance>0 check below.
  const query: any =
    filters.status === "foreclosed" || filters.status === "expired"
      ? {}
      : { ledgerBalance: { $gt: 0 } };
  if (filters.status === "foreclosed") {
    query.status = "foreclosed";
  }

  if (filters.caseNo) {
    query.caseNo = { $regex: filters.caseNo, $options: "i" };
  }

  if (filters.name) {
    query.name = { $regex: filters.name, $options: "i" };
  }

  if (filters.prefix) {
    query.caseNo = { $regex: `^${filters.prefix}`, $options: "i" };
  }

  let loans = await Loan.find(query);

  if (filters.status === "pending" || filters.status === "paid") {
    const caseStatus = await LoanSchedule.aggregate([
      { $group: { _id: "$caseNo", statuses: { $addToSet: "$status" } } },
      {
        $project: {
          caseNo: "$_id",
          isFullyPaid: { $setEquals: ["$statuses", ["Paid"]] },
          hasPending: { $in: ["Pending", "$statuses"] },
        },
      },
    ]);
    const paidCaseNos = new Set(
      caseStatus.filter((c) => c.isFullyPaid).map((c) => c.caseNo)
    );
    const pendingCaseNos = new Set(
      caseStatus.filter((c) => !c.isFullyPaid && c.hasPending).map((c) => c.caseNo)
    );
    // Foreclosed/expired cases have their own tabs — never show them under
    // Pending or Paid.
    loans = loans.filter((loan) => {
      if (loan.status === "foreclosed") return false;
      return filters.status === "paid"
        ? paidCaseNos.has(loan.caseNo)
        : pendingCaseNos.has(loan.caseNo);
    });
  } else if (filters.status === "expired") {
    const caseStatus = await LoanSchedule.aggregate([
      { $group: { _id: "$caseNo", statuses: { $addToSet: "$status" } } },
      {
        $project: {
          caseNo: "$_id",
          hasPending: { $in: ["Pending", "$statuses"] },
          hasDue: { $in: ["Due", "$statuses"] },
        },
      },
    ]);
    const expiredCaseNos = new Set(
      caseStatus.filter((c) => !c.hasPending && c.hasDue).map((c) => c.caseNo)
    );
    loans = loans.filter(
      (loan) => loan.status !== "foreclosed" && expiredCaseNos.has(loan.caseNo)
    );
  }

  // EMI amount + how much is currently Due, so the ledger view can show
  // whether a case's positive balance is just round-off leftover or an
  // actual surplus sitting unapplied (ledgerBalance beyond what's Due —
  // the same pattern as a stuck/unswept payment).
  const caseNos = loans.map((l) => l.caseNo);
  const scheduleStats = await LoanSchedule.aggregate([
    { $match: { caseNo: { $in: caseNos } } },
    {
      $group: {
        _id: "$caseNo",
        emi: { $first: "$emi" },
        dueAmount: {
          $sum: { $cond: [{ $eq: ["$status", "Due"] }, "$emi", 0] },
        },
      },
    },
  ]);
  const statsMap = new Map(scheduleStats.map((s) => [s._id, s]));

  return loans.map((loan) => {
    const stats = statsMap.get(loan.caseNo) || { emi: 0, dueAmount: 0 };
    const ledgerBalance = loan.ledgerBalance ?? 0;
    const dueAmount = stats.dueAmount ?? 0;
    return {
      ...loan.toObject(),
      emiAmount: stats.emi ?? 0,
      dueAmount,
      excessAmount: Math.max(0, ledgerBalance - dueAmount),
    };
  });
};

export const generateLedgerCSV = async (
  filters: LedgerFilter
): Promise<string> => {
  const loans = await getLedgerLoans(filters);

  const formattedData = loans.map((loan) => ({
    caseNo: loan.caseNo,
    name: loan.name,
    ledgerBalance: loan.ledgerBalance ?? 0,
    emiAmount: loan.emiAmount ?? 0,
    dueAmount: loan.dueAmount ?? 0,
    excessAmount: loan.excessAmount ?? 0,
  }));

  const fields = ["caseNo", "name", "ledgerBalance", "emiAmount", "dueAmount", "excessAmount"];
  const json2csvParser = new Parser({ fields });
  return json2csvParser.parse(formattedData);
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
    {
      // Count paid/due across ALL of the case's installments before the
      // date filter narrows loanSchedules down to just the matching one —
      // so the report can show "12 paid, 5 due" alongside the row, not
      // just the single installment that fell in the selected range.
      $addFields: {
        installmentsPaid: {
          $size: {
            $filter: {
              input: "$loanSchedules",
              cond: { $eq: ["$$this.status", "Paid"] },
            },
          },
        },
        installmentsDue: {
          $size: {
            $filter: {
              input: "$loanSchedules",
              cond: { $eq: ["$$this.status", "Due"] },
            },
          },
        },
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
        ledgerBalance: 1,
        installmentsPaid: 1,
        installmentsDue: 1,
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
        "loanSchedules.voucherId": 1,
        "loanSchedules.voucherDate": 1,
        "loanSchedules.emi": 1,
        "loanSchedules.interestAmt": 1,
        "loanSchedules.principalReduction": 1,
        "loanSchedules.status": 1,
      },
    },
  ]);

  const formattedData = loans.map((loan) => ({
    voucherDate: new Date(loan.loanSchedules.voucherDate).toLocaleDateString(),
    caseNo: loan.caseNo,
    emiNo: loan.loanSchedules.voucherId?.split("/")[1] || "",
    emi: loan.loanSchedules.emi,
    status: loan.loanSchedules.status || "",
    interestAmount: loan.loanSchedules.interestAmt ?? 0,
    principalReduction: loan.loanSchedules.principalReduction ?? 0,
    umrnNo: loan.umrnNo || "",
    accountNo: "99998899988",
  }));

  const fields = ["voucherDate", "caseNo", "emiNo", "emi", "status", "interestAmount", "principalReduction", "umrnNo", "accountNo"];
  const json2csvParser = new Parser({ fields });
  return json2csvParser.parse(formattedData);
};

// Sweeps a loan's ledgerBalance against its Due schedules (oldest first),
// marking each one Paid once enough balance has landed to cover it. Shared
// by every payment-entry path (NACH transaction upload, bulk ledger upload)
// so a payment is reflected in the schedule immediately, not just the ledger.
const applyLedgerToSchedules = async (caseNo: string) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dueSchedules = await LoanSchedule.find({
    caseNo,
    status: "Due",
    voucherDate: { $lte: today },
  }).sort({ voucherDate: 1 });

  const loan = await Loan.findOne({ caseNo });
  if (!loan) return;

  for (const schedule of dueSchedules) {
    const emi = schedule.emi ?? 0;
    if ((loan.ledgerBalance ?? 0) < emi) break;
    const interest = schedule.interestAmt ?? 0;
    const principal = schedule.principalReduction ?? 0;
    loan.ledgerBalance = (loan.ledgerBalance ?? 0) - emi;
    loan.futureUnearnedInterest = Math.max(0, (loan.futureUnearnedInterest ?? 0) - interest);
    loan.principalOutstands = Math.max(0, (loan.principalOutstands ?? 0) - principal);
    schedule.status = "Paid";
    schedule.paidAmount = emi;
    await schedule.save();
  }
  await loan.save();
};

export const processTransactionData = async (rows: any[]) => {
  const currentUploadDate = new Date();

  for (const row of rows) {
    const Status = row["Status"];
    const UMRN = row["UMRN"];
    const name = row["Beneficiary_Account_Holder_Name"];
    const amount = Number(String(row["Amount"] ?? "").replace(/,/g, ""));
    const reference = row["Transaction_Reference"];
    const VocharId = uuidv4();
    const narration = `${reference}_${name}_${UMRN}`;
    const paymentMode = row["paymentMode"]?.toString().trim() || "NACH";
    const valueDate = row["Value_Date"];
    const caseNo = reference;

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

    const createdTxn = await Transaction.create(transaction);
    const loan = await Loan.findOne({ caseNo });

    if (loan) {
      loan.transactions = loan.transactions || [];
      loan.transactions.push(createdTxn._id as mongoose.Types.ObjectId);

      if (Status === "Completed") {
        loan.ledgerBalance = (loan.ledgerBalance || 0) + amount;
      }

      await loan.save();

      if (Status === "Completed") {
        await applyLedgerToSchedules(caseNo);
      }
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
  remarks?: string,
  date?: Date
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
    ...(date && { date }),
  });
  loan.transactions = loan.transactions || [];
  loan.transactions.push(transaction._id as mongoose.Types.ObjectId);
  await loan.save();

  // Process due installments for this case immediately after payment
  await applyLedgerToSchedules(caseNo);
  const updatedLoan = await Loan.findOne({ caseNo });

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

// Closes a loan out mid-tenure: pays off the remaining principal in one
// shot instead of walking the schedule EMI-by-EMI like every other payment
// path does. Remaining Pending/Due rows are marked "Foreclosed" (not
// "Paid") so reports can tell a case that ran its full term apart from one
// that was paid off early.
export const foreclosureLoan = async (
  caseNo: string,
  charges: number = 0,
  paymentMode: string = "Cash",
  remarks?: string
): Promise<{ success: boolean; message?: string; payoffAmount?: number; loan?: ILoan }> => {
  const loan = await Loan.findOne({ caseNo });
  if (!loan) {
    return { success: false, message: "Loan not found for provided caseNo." };
  }
  if (loan.status === "foreclosed") {
    return { success: false, message: "Loan is already foreclosed." };
  }

  const remainingSchedules = await LoanSchedule.find({
    caseNo,
    status: { $in: ["Pending", "Due"] },
  });
  if (remainingSchedules.length === 0) {
    return { success: false, message: "Loan has no remaining installments — it is already fully paid." };
  }

  const payoffAmount = Math.round((loan.principalOutstands ?? 0) + charges);

  // Only flip status — principalDue/futureUnearnedInterestLoanSchedule stay
  // as the original amortization schedule computed them, so an unforeclose
  // can restore these rows exactly instead of having to re-derive numbers
  // that were destroyed here.
  await LoanSchedule.updateMany(
    { caseNo, status: { $in: ["Pending", "Due"] } },
    { $set: { status: "Foreclosed" } }
  );

  const transaction = await Transaction.create({
    caseNo,
    amount: payoffAmount,
    otherCharges: charges,
    paymentMode,
    remarks: remarks || "Loan foreclosure settlement",
  });
  loan.transactions = loan.transactions || [];
  loan.transactions.push(transaction._id as mongoose.Types.ObjectId);
  loan.foreclosureTransactionId = transaction._id as mongoose.Types.ObjectId;

  // Snapshot so unforecloseLoan can put these back exactly as they were.
  loan.preForeclosurePrincipalOutstands = loan.principalOutstands ?? 0;
  loan.preForeclosureFutureUnearnedInterest = loan.futureUnearnedInterest ?? 0;

  loan.principalOutstands = 0;
  loan.futureUnearnedInterest = 0;
  loan.status = "foreclosed";
  loan.foreclosureDate = new Date();
  loan.foreclosureAmount = payoffAmount;
  loan.foreclosureCharges = charges;
  await loan.save();

  return { success: true, payoffAmount, loan };
};

// Reverses foreclosureLoan: restores the closed-out schedule rows to
// Pending/Due (whichever their date implies today) and puts the
// pre-foreclosure principal/interest snapshot back, then deletes the
// foreclosure payoff transaction it logged.
export const unforecloseLoan = async (
  caseNo: string
): Promise<{ success: boolean; message?: string; loan?: ILoan }> => {
  const loan = await Loan.findOne({ caseNo });
  if (!loan) {
    return { success: false, message: "Loan not found for provided caseNo." };
  }
  if (loan.status !== "foreclosed") {
    return { success: false, message: "Loan is not foreclosed." };
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const foreclosedSchedules = await LoanSchedule.find({ caseNo, status: "Foreclosed" });
  for (const schedule of foreclosedSchedules) {
    schedule.status = schedule.voucherDate && schedule.voucherDate <= today ? "Due" : "Pending";
    await schedule.save();
  }

  loan.principalOutstands = loan.preForeclosurePrincipalOutstands ?? loan.principalOutstands;
  loan.futureUnearnedInterest = loan.preForeclosureFutureUnearnedInterest ?? loan.futureUnearnedInterest;
  loan.status = "active";
  loan.foreclosureDate = undefined;
  loan.foreclosureAmount = undefined;
  loan.foreclosureCharges = undefined;
  loan.preForeclosurePrincipalOutstands = undefined;
  loan.preForeclosureFutureUnearnedInterest = undefined;

  if (loan.foreclosureTransactionId) {
    await Transaction.findByIdAndDelete(loan.foreclosureTransactionId);
    loan.transactions = (loan.transactions || []).filter(
      (id) => !id.equals(loan.foreclosureTransactionId as mongoose.Types.ObjectId)
    );
    loan.foreclosureTransactionId = undefined;
  }

  await loan.save();
  return { success: true, loan };
};

export const foreclosureLoansBulk = async (
  caseNos: string[]
): Promise<{ successCaseNos: string[]; failed: { caseNo: string; message: string }[] }> => {
  const successCaseNos: string[] = [];
  const failed: { caseNo: string; message: string }[] = [];

  for (const caseNo of caseNos) {
    const result = await foreclosureLoan(caseNo);
    if (result.success) {
      successCaseNos.push(caseNo);
    } else {
      failed.push({ caseNo, message: result.message || "Failed to foreclose" });
    }
  }

  return { successCaseNos, failed };
};

export const editTransaction = async (
  transactionId: string,
  updates: { amount?: number; otherCharges?: number; paymentMode?: string; remarks?: string; date?: Date }
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
  if (updates.date !== undefined) transaction.date = updates.date;
  await transaction.save();

  // Apply new amount
  loan.ledgerBalance = (loan.ledgerBalance || 0) + (transaction.amount || 0);
  await loan.save();

  // Run cron logic
  await applyCronForLoan(loan);

  return { success: true, ledgerBalance: loan.ledgerBalance };
};


