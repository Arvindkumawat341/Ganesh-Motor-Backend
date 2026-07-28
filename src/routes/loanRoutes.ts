import express from "express";
import * as loanController from "../controllers/loanController";
import upload from "../middlewares/upload";
const router = express.Router();
router.post("/loans", loanController.createLoan);
router.post(
  "/loans/upload",
  upload.single("file"),
  loanController.uploadLoansCSV
);
router.post(
  "/upload-umrn-file",
  upload.single("file"),
  loanController.uploadUmrnFile
);
router.get("/loans-fetch", loanController.getAllLoans);
router.get("/loans-paid", loanController.getPaidLoans);
router.get("/loans-filter", loanController.filterLoans);
router.get("/loan-schedule-filter", loanController.filterLoanSchedule);
router.get("/loan-schedule/:caseNo", loanController.getLoanSchedule);
router.get("/principal-due", loanController.getPrincipalDue);
router.get("/loan-csv-download", loanController.downloadLoanCSV);
router.post(
  "/upload-transactions",
  upload.single("file"),
  loanController.uploadTransactions
);
router.get("/transactions", loanController.getUploadedTransactions);
router.post("/update-ledger-balance", loanController.updateLedgerBalance);
router.post(
  "/bulk-ledger-upload",
  upload.single("file"),
  loanController.bulkLedgerUpload
);
router.get("/installments/:caseNo", loanController.getInstallmentsByCaseNo);
router.post("/run-cron", loanController.runCronJob);
router.delete("/transactions/:id", loanController.deleteTransaction);
router.put("/transactions/:id", loanController.editTransaction);

export default router;
