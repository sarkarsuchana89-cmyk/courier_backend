const express = require("express");
const router = express.Router();
const otpController = require("../controllers/otpController");
const rateLimit = require("express-rate-limit");

// Rate limiter for OTP sending: 10 requests per 5 minutes per IP
const sendOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, 
  message: { message: "Too many OTP requests. Please try again after 5 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for OTP verification: 20 attempts per 5 minutes per IP
const verifyOtpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: { message: "Too many verification attempts. Please try again after 5 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/send", sendOtpLimiter, otpController.sendOTP);
router.post("/verify", verifyOtpLimiter, otpController.verifyOTP);

module.exports = router;
