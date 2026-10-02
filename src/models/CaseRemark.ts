import mongoose, { Schema, Document, model } from "mongoose";

export interface ICaseRemark extends Document {
  caseNo: string;
  text: string;
  createdAt: Date;
}

const caseRemarkSchema = new Schema<ICaseRemark>(
  {
    caseNo: { type: String, required: true, index: true },
    text: { type: String, required: true },
  },
  { timestamps: true }
);

export default model<ICaseRemark>("CaseRemark", caseRemarkSchema);
