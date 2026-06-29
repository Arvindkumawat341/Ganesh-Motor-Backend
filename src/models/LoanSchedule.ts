import mongoose from "mongoose";

const loanScheduleSchema = new mongoose.Schema({
  caseNo: String,
  voucherId: String,
  voucherDate: Date,
  emi: Number,
  interestAmt: Number,
  principalReduction: Number,
  principalDue: Number,
  status: String, 
  futureUnearnedInterestLoanSchedule:Number,
  paidAmount: { type: Number, default: 0 },
});

export const LoanSchedule = mongoose.model("LoanSchedule", loanScheduleSchema);
