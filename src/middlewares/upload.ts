import multer from "multer";

// memoryStorage: no filesystem needed — works on Vercel serverless
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export default upload;
