const db = require("../config/db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
require("dotenv").config();

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Generate a 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP to user email
 */
exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const otp = generateOTP();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

  try {
    // Upsert OTP record
    const query = `
      INSERT INTO otps (email, otp_hash, expires_at, attempts, verified)
      VALUES (?, ?, ?, 0, FALSE)
      ON DUPLICATE KEY UPDATE
      otp_hash = VALUES(otp_hash),
      expires_at = VALUES(expires_at),
      attempts = 0,
      verified = FALSE
    `;
    
    // Note: If using a simple mysql connection, we might need a different syntax or two queries.
    // Let's check if the email exists first to be safe, or use REPLACE INTO if applicable.
    // For TiDB/MySQL ON DUPLICATE KEY UPDATE works if email is UNIQUE or PRIMARY KEY.
    // I'll assume email should be unique for OTP purposes.
    
    // Let's check if we should add UNIQUE constraint to email.
    // For now, I'll use a transaction or just try the query.
    
    db.query(query, [email, otpHash, expiresAt], async (err) => {
      if (err) {
        console.error("Error saving OTP:", err);
        return res.status(500).json({ message: "Error generating OTP" });
      }

      // Send Email
      const mailOptions = {
        from: `"Shipment Tracking" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Shipment Reschedule OTP Verification",
        text: `Your OTP is: ${otp}. This OTP expires in 5 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #D97706;">Shipment Reschedule Verification</h2>
            <p>Your OTP for shipment rescheduling is:</p>
            <div style="font-size: 24px; font-weight: bold; background: #f4f4f4; padding: 10px; display: inline-block; border-radius: 5px;">
              ${otp}
            </div>
            <p>This OTP will expire in <strong>5 minutes</strong>.</p>
            <p>If you did not request this, please ignore this email.</p>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "OTP sent successfully" });
      } catch (mailErr) {
        console.error("Error sending email:", mailErr);
        res.status(500).json({ message: "Error sending email. Please check SMTP configuration." });
      }
    });
  } catch (error) {
    console.error("OTP generation error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Verify OTP
 */
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  const query = "SELECT * FROM otps WHERE email = ? ORDER BY created_at DESC LIMIT 1";

  db.query(query, [email], async (err, results) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "No OTP found for this email" });
    }

    const otpData = results[0];

    // Check if verified already
    if (otpData.verified) {
      return res.status(400).json({ message: "OTP already used" });
    }

    // Check expiry
    if (new Date() > new Date(otpData.expires_at)) {
      return res.status(400).json({ message: "OTP has expired" });
    }

    // Check max attempts
    if (otpData.attempts >= 5) {
      return res.status(400).json({ message: "Maximum attempts exceeded. Please request a new OTP." });
    }

    // Compare OTP
    const isValid = await bcrypt.compare(otp, otpData.otp_hash);

    if (!isValid) {
      // Increment attempts
      db.query("UPDATE otps SET attempts = attempts + 1 WHERE id = ?", [otpData.id]);
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Mark as verified
    db.query("UPDATE otps SET verified = TRUE WHERE id = ?", [otpData.id], (updateErr) => {
      if (updateErr) {
        console.error("Update error:", updateErr);
        return res.status(500).json({ message: "Error verifying OTP" });
      }
      res.status(200).json({ message: "OTP verified successfully", verified: true });
    });
  });
};
