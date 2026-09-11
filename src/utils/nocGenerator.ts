import PDFDocument from "pdfkit";
import { ILoan } from "../models/loanModel";

export const generateNOCBuffer = (loan: ILoan): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const today = new Date();
    const closureDate = loan.foreclosureDate
      ? new Date(loan.foreclosureDate)
      : today;

    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("GANESH MOTORS", { align: "center" });
    doc
      .fontSize(11)
      .font("Helvetica")
      .text("No Objection Certificate", { align: "center" });
    doc.moveDown(2);

    doc.fontSize(11).text(`Date: ${today.toLocaleDateString("en-IN")}`);
    doc.moveDown();

    doc.text(
      "This is to certify that the loan account detailed below has been fully repaid, and there are no outstanding dues against it as on the date of this certificate."
    );
    doc.moveDown();

    const rows: [string, string][] = [
      ["Case No", loan.caseNo],
      ["Borrower Name", loan.name],
      ["Address", loan.address],
      ["Chassis No", loan.CHASSISNO || "-"],
      ["Engine No", loan.ENGINENO || "-"],
      ["Loan Amount", `Rs. ${loan.loanAmount}`],
      ["Loan Start Date", new Date(loan.startDate).toLocaleDateString("en-IN")],
      ["Closure Date", closureDate.toLocaleDateString("en-IN")],
      [
        "Closure Type",
        loan.status === "foreclosed" ? "Foreclosure (Pre-closure)" : "Regular Completion",
      ],
    ];
    rows.forEach(([label, value]) => {
      doc
        .font("Helvetica-Bold")
        .text(`${label}: `, { continued: true })
        .font("Helvetica")
        .text(value);
    });

    doc.moveDown(2);
    doc.text(
      "We hereby confirm that we have no objection to the release of hypothecation on the above vehicle, and the borrower is free to transfer or use the vehicle without any lien from our end."
    );

    doc.moveDown(4);
    doc.text("For Ganesh Motors,");
    doc.moveDown(3);
    doc.text("Authorized Signatory");

    doc.end();
  });
};
