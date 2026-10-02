import mongoose, { Schema, Document, model } from "mongoose";

export interface ITransaction extends Document {
  UMRN?: string;
  Beneficiary_Account_Holder_Name?: string;
  Amount?: number;
  Transaction_Reference?: string;
  VocharId?: string;
  narration?: string;
  paymentMode: string;
  Status?: string;
  Value_Date?: string;
  VocharDate?: Date;
  caseNo?: string;
  amount?: number;
  otherCharges?: number;
  remarks?: string;
  date?: Date;
  transferType?: "in" | "out";
  linkedCaseNo?: string;
  linkedTransactionId?: mongoose.Types.ObjectId;
}

const transactionSchema = new Schema<ITransaction>(
  {
    UMRN: { type: String },
    Beneficiary_Account_Holder_Name: { type: String },
    Amount: { type: Number },
    Transaction_Reference: { type: String },
    VocharId: { type: String, unique: true, sparse: true },
    narration: { type: String },
    Value_Date: { type: String },
    Status: { type: String },
    VocharDate: { type: Date },
    paymentMode: { type: String, default: "NACH", required: true },
    caseNo: { type: String },
    amount: { type: Number },
    otherCharges: { type: Number, default: 0 },
    remarks: { type: String },
    date: { type: Date, default: Date.now },
    transferType: { type: String, enum: ["in", "out"] },
    linkedCaseNo: { type: String },
    linkedTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
  },
  { timestamps: true }
);

export default model<ITransaction>("Transaction", transactionSchema);
