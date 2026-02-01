require("dotenv").config();
const express = require("express");
const axios = require("axios");
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

    // Read resume file and convert to Base64
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64File = fileBuffer.toString("base64");

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "SP Engineering Careers",
          email: "support@spengineeringandconsultancy.com"
        },
        to: [
          {
            email: process.env.RECEIVER_EMAIL,
            name: "SP Engineering"
          }
        ],
        replyTo: {
          email,
          name
        },
        subject: `New ${type} Application – ${position}`,
        htmlContent: `
          <div style="font-family:Arial;background:#f4f6f8;padding:20px;">
            <div style="max-width:600px;margin:auto;background:#fff;border-radius:6px;">
              <div style="background:#1c3f60;color:#fff;padding:16px;">
                <h2>SP Engineering Consultancy</h2>
                <p>New Career Application</p>
              </div>
              <div style="padding:20px;">
                <table cellpadding="6">
                  <tr><td><strong>Name:</strong></td><td>${name}</td></tr>
                  <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
                  <tr><td><strong>Phone:</strong></td><td>${phone}</td></tr>
                  <tr><td><strong>Type:</strong></td><td>${type}</td></tr>
                  <tr><td><strong>Position:</strong></td><td>${position}</td></tr>
                </table>
                <hr>
                <p><strong>Message:</strong></p>
                <p style="background:#f8f9fb;padding:12px;">
                  ${message || "N/A"}
                </p>
                <p>📎 Resume attached</p>
              </div>
            </div>
          </div>
        `,
        attachment: [
          {
            name: req.file.originalname,
            content: base64File
          }
        ]
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({ success: true, message: "Application submitted successfully" });

  } catch (err) {
    console.error("Brevo Career API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Application submission failed" });
  }
});


/* =========================
   CONTACT FORM ROUTE
   ========================= */
app.post("/contact-inquiry", limiter, async (req, res) => {
  try {
    if (req.body.website) return res.status(200).end(); // honeypot

    const { name, email, phone, inquiryType, company, location, message } = req.body;

    if (!name || !email || !phone || !inquiryType || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "SP Engineering Consultancy",
          email: "support@spengineeringandconsultancy.com"
        },
        to: [
          {
            email: process.env.RECEIVER_EMAIL,
            name: "SP Engineering"
          }
        ],
        replyTo: {
          email,
          name
        },
        subject: `New Contact Inquiry – ${inquiryType}`,
        htmlContent: `
          <div style="font-family:Arial;background:#f4f6f8;padding:20px;">
            <div style="max-width:600px;margin:auto;background:#fff;border-radius:6px;">
              <div style="background:#0f2a44;color:#fff;padding:16px;">
                <h2>SP Engineering Consultancy</h2>
                <p>New Contact Inquiry</p>
              </div>
              <div style="padding:20px;">
                <table cellpadding="6">
                  <tr><td><strong>Name:</strong></td><td>${name}</td></tr>
                  <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
                  <tr><td><strong>Phone:</strong></td><td>${phone}</td></tr>
                  <tr><td><strong>Inquiry:</strong></td><td>${inquiryType}</td></tr>
                  <tr><td><strong>Company:</strong></td><td>${company || "N/A"}</td></tr>
                  <tr><td><strong>Location:</strong></td><td>${location || "N/A"}</td></tr>
                </table>
                <hr>
                <p><strong>Message:</strong></p>
                <p style="background:#f8f9fb;padding:12px;">${message}</p>
              </div>
            </div>
          </div>
        `
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Brevo API error:", err.response?.data || err.message);
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
