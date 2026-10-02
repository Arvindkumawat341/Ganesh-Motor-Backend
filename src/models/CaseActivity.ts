import { Schema, Document, model } from "mongoose";

export interface ICaseActivity extends Document {
  caseNo: string;
  type: string;
  message: string;
  createdAt: Date;
}

const caseActivitySchema = new Schema<ICaseActivity>(
  {
    caseNo: { type: String, required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
  },
  { timestamps: true }
);

export default model<ICaseActivity>("CaseActivity", caseActivitySchema);
