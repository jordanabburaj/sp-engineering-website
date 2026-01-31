require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

/* =========================
   BASIC SECURITY
   ========================= */
app.disable("x-powered-by");

/* =========================
   RATE LIMITING
   ========================= */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: "Too many submissions. Please try again later." }
});

/* =========================
   MIDDLEWARE
   ========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   UPLOADS FOLDER
   ========================= */
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

/* =========================
   FILE UPLOAD CONFIG
   ========================= */
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, Date.now() + "-" + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter(req, file, cb) {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Invalid file type"));
    }
    cb(null, true);
  }
});

/* =========================
   EMAIL TRANSPORTER (FIXED)
   ========================= */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});



/* =========================
   CAREER APPLICATION ROUTE
   ========================= */
app.post("/apply", limiter, upload.single("resume"), async (req, res) => {
  try {
    if (req.body.company) return res.status(200).end(); // honeypot

    const { name, email, phone, type, position, message } = req.body;

    if (!name || !email || !phone || !type || !position || !req.file) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await transporter.sendMail({
      from: `"SP Engineering Careers" <${process.env.EMAIL_USER}>`,
      to: process.env.RECEIVER_EMAIL,
      subject: `New ${type} Application – ${position}`,
      html: `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;padding:20px;">
        <div style="max-width:600px;margin:auto;background:#fff;border-radius:6px;">
          <div style="background:#1c3f60;color:#fff;padding:16px;">
            <h2 style="margin:0;">SP Engineering Consultancy</h2>
            <p style="margin:4px 0 0;">New Career Application</p>
          </div>
          <div style="padding:20px;">
            <table width="100%" cellpadding="6">
              <tr><td><strong>Name:</strong></td><td>${name}</td></tr>
              <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
              <tr><td><strong>Phone:</strong></td><td>${phone}</td></tr>
              <tr><td><strong>Type:</strong></td><td>${type}</td></tr>
              <tr><td><strong>Position:</strong></td><td>${position}</td></tr>
            </table>
            <hr>
            <p><strong>Message:</strong></p>
            <p style="background:#f8f9fb;padding:12px;border-radius:4px;">
              ${message || "N/A"}
            </p>
            <p>📎 Resume attached</p>
          </div>
          <div style="background:#f0f2f5;text-align:center;padding:10px;font-size:12px;">
            Submitted via SP Engineering Website
          </div>
        </div>
      </div>
      `,
      attachments: [
        {
          filename: req.file.originalname,
          path: req.file.path
        }
      ]
    });

    fs.unlink(req.file.path, () => {});
    res.json({ success: true, message: "Application submitted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Application submission failed" });
  }
});

/* =========================
   CONTACT FORM ROUTE
   ========================= */
app.post("/contact-inquiry", limiter, async (req, res) => {
  try {
    if (req.body.website) return res.status(200).end(); // honeypot

    const { name, email, phone, inquiryType, company, location, message } =
      req.body;

    if (!name || !email || !phone || !inquiryType || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await transporter.sendMail({
      from: `"SP Engineering Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.RECEIVER_EMAIL,
      subject: `New Contact Inquiry – ${inquiryType}`,
      html: `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;padding:20px;">
        <div style="max-width:600px;margin:auto;background:#fff;border-radius:6px;">
          <div style="background:#0f2a44;color:#fff;padding:16px;">
            <h2 style="margin:0;">SP Engineering Consultancy</h2>
            <p style="margin:4px 0 0;">New Contact Inquiry</p>
          </div>
          <div style="padding:20px;">
            <table width="100%" cellpadding="6">
              <tr><td><strong>Name:</strong></td><td>${name}</td></tr>
              <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
              <tr><td><strong>Phone:</strong></td><td>${phone}</td></tr>
              <tr><td><strong>Inquiry:</strong></td><td>${inquiryType}</td></tr>
              <tr><td><strong>Company:</strong></td><td>${company || "N/A"}</td></tr>
              <tr><td><strong>Location:</strong></td><td>${location || "N/A"}</td></tr>
            </table>
            <hr>
            <p><strong>Message:</strong></p>
            <p style="background:#f8f9fb;padding:12px;border-radius:4px;">
              ${message}
            </p>
          </div>
          <div style="background:#f0f2f5;text-align:center;padding:10px;font-size:12px;">
            Submitted via SP Engineering Website
          </div>
        </div>
      </div>
      `
    });

    res.json({ success: true, message: "Inquiry sent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Inquiry submission failed" });
  }
});

/* =========================
   SERVER START
   ========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
