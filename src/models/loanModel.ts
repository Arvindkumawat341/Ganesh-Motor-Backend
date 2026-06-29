import mongoose, { Document, Schema } from "mongoose";

export interface ILoan extends Document {
  caseNo: string;
  name: string;
  address: string;
  contactNo: number[];
  loanAmount: number;
  tenure: number;
  annualInterest: number;
  startDate: Date;
  emiDate: Date;
  loanScheduleIds?: string[];
  umrnNo: string;
  principalOutstands: number;
  futureUnearnedInterest: number;
  ledgerBalance?: number;
  CHASSISNO: string;
  ENGINENO: string;
  bankName: String;
  bankaccountnumber: String;
  ifcecode: String;
  accountype: String;
  bankbranch: String;
  addharNo:string;
  panNo:string;
  transactions?: mongoose.Types.ObjectId[];
}

const loanSchema: Schema = new Schema({
  caseNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  contactNo: [{ type: Number, required: true }],
  loanAmount: { type: Number, required: true },
  tenure: { type: Number, required: true },
  annualInterest: { type: Number, required: true },
  startDate: { type: Date, required: true },
  emiDate: { type: Date, required: true },
  umrnNo: { type: String },
  principalOutstands: { type: Number },
  futureUnearnedInterest: { type: Number },
  ledgerBalance: { type: Number, default: 0 },
  CHASSISNO: { type: String },
  ENGINENO: { type: String },
  bankName: { type: String },
  bankaccountnumber: { type: String },
  ifcecode: { type: String },
  accountype: { type: String },
  bankbranch: { type: String },
  addharNo: { type: String },
  panNo: { type: String },

  loanScheduleIds: [
    { type: mongoose.Schema.Types.ObjectId, ref: "LoanSchedule" },
  ],

   transactions: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" }
  ],
});

export const Loan = mongoose.model<ILoan>("Loan", loanSchema);
