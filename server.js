require("dotenv").config();

const express = require("express");
const axios = require("axios");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const bcrypt = require("bcryptjs");
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
   MONGODB CONNECTION
   ========================= */

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB Atlas connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
  });

  /* =========================
   REVIEW MODEL
   ========================= */

const reviewSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },

    feedback: {
      type: String,
      required: true,
      trim: true,
      maxlength: 700
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    versionKey: false
  }
);

const Review = mongoose.model("Review", reviewSchema);

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

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "100kb"
  })
);

/* =========================
   ADMIN SESSION
   ========================= */

app.use(
  session({
    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions"
    }),

    cookie: {
      httpOnly: true,

      secure:
        process.env.NODE_ENV === "production",

      sameSite: "lax",

      maxAge: 1000 * 60 * 60 * 8
    }
  })
);


/* =========================
   ADMIN LOGIN RATE LIMIT
   ========================= */

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,

  message: {
    success: false,
    error: "Too many login attempts. Please try again later."
  }
});


/* =========================
   ADMIN LOGIN
   ========================= */

app.post("/admin/login", adminLoginLimiter, async (req, res) => {

  try {

    const { username, password } = req.body;

    console.log("🔐 Admin login attempt:", username);


    if (!username || !password) {

      return res.status(400).json({
        success: false,
        error: "Username and password are required."
      });

    }


    const usernameMatches =
      username === process.env.ADMIN_USERNAME;


    const passwordMatches =
      await bcrypt.compare(
        password,
        process.env.ADMIN_PASSWORD_HASH
      );


    console.log(
      "Username correct:",
      usernameMatches
    );

    console.log(
      "Password correct:",
      passwordMatches
    );


    if (!usernameMatches || !passwordMatches) {

      return res.status(401).json({
        success: false,
        error: "Invalid username or password."
      });

    }


    /* =========================
       CREATE ADMIN SESSION
       ========================= */

    req.session.isAdmin = true;


    req.session.save((err) => {

      if (err) {

        console.error(
          "❌ Session save error:",
          err
        );

        return res.status(500).json({
          success: false,
          error: "Unable to create admin session."
        });

      }


      console.log(
        "✅ Admin session created"
      );

      console.log(
        "Session ID:",
        req.sessionID
      );

      console.log(
        "Session admin:",
        req.session.isAdmin
      );


      return res.json({
        success: true,
        message: "Login successful."
      });

    });

  } catch (err) {

    console.error(
      "❌ Admin login error:",
      err
    );

    return res.status(500).json({
      success: false,
      error: "Unable to login."
    });

  }

});


/* =========================
   ADMIN LOGOUT
   ========================= */

app.post("/admin/logout", (req, res) => {

  req.session.destroy((err) => {

    if (err) {

      console.error(
        "❌ Logout error:",
        err
      );

      return res.status(500).json({
        success: false,
        error: "Unable to logout."
      });

    }


    res.clearCookie("connect.sid");


    return res.json({
      success: true
    });

  });

});


/* =========================
   ADMIN AUTH MIDDLEWARE
   ========================= */

function requireAdmin(req, res, next) {

  if (
    req.session &&
    req.session.isAdmin === true
  ) {

    return next();

  }


  return res.status(401).json({
    success: false,
    error: "Unauthorized."
  });

}
/* =========================
   SUBMIT CUSTOMER REVIEW
   ========================= */

app.post("/submit-review", limiter, async (req, res) => {

  try {

    // Honeypot protection
    if (req.body.website) {
      return res.status(200).json({
        success: true
      });
    }


    const {
      name,
      rating,
      feedback
    } = req.body;


    // Required fields
    if (!name || !rating || !feedback) {

      return res.status(400).json({
        success: false,
        error: "Please complete all required fields."
      });

    }


    // Clean input
    const cleanName =
      String(name).trim();

    const cleanFeedback =
      String(feedback).trim();

    const numericRating =
      Number(rating);


    // Validate name
    if (
      cleanName.length < 2 ||
      cleanName.length > 60
    ) {

      return res.status(400).json({
        success: false,
        error: "Invalid name."
      });

    }


    // Validate rating
    if (
      !Number.isInteger(numericRating) ||
      numericRating < 1 ||
      numericRating > 5
    ) {

      return res.status(400).json({
        success: false,
        error: "Rating must be between 1 and 5."
      });

    }


    // Validate feedback
    if (
      cleanFeedback.length < 5 ||
      cleanFeedback.length > 700
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Feedback must be between 5 and 700 characters."
      });

    }


    // Save review to MongoDB
    const review = await Review.create({
      name: cleanName,
      rating: numericRating,
      feedback: cleanFeedback,
      status: "pending"
    });


    console.log(
      `📝 New review submitted: ${review._id}`
    );


    return res.status(201).json({

      success: true,

      message:
        "Thank you for your feedback. Your review has been submitted for approval."

    });


  } catch (err) {

    console.error(
      "Review submission error:",
      err
    );


    return res.status(500).json({

      success: false,

      error:
        "Unable to submit review. Please try again later."

    });

  }

});

/* =========================
   STATIC FILES
   ========================= */

app.use(express.static(path.join(__dirname, "public")));




/* =========================
   GET APPROVED REVIEWS
   ========================= */

app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await Review.find({
      status: "approved"
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      reviews
    });

  } catch (err) {
    console.error("Fetch reviews error:", err);

    res.status(500).json({
      success: false,
      error: "Unable to load reviews."
    });
  }
});

/* =========================
   ADMIN - GET ALL REVIEWS
   ========================= */

app.get("/admin/api/reviews", requireAdmin, async (req, res) => {
  try {

    const reviews = await Review.find({})
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      reviews
    });

  } catch (err) {

    console.error("Admin fetch reviews error:", err);

    res.status(500).json({
      success: false,
      error: "Unable to load reviews."
    });
  }
});


/* =========================
   ADMIN - APPROVE REVIEW
   ========================= */

app.patch(
  "/admin/api/reviews/:id/approve",
  requireAdmin,
  async (req, res) => {

    try {

      const review = await Review.findByIdAndUpdate(
        req.params.id,
        {
          status: "approved"
        },
        {
          new: true
        }
      );

      if (!review) {
        return res.status(404).json({
          success: false,
          error: "Review not found."
        });
      }

      res.json({
        success: true,
        message: "Review approved.",
        review
      });

    } catch (err) {

      console.error("Approve review error:", err);

      res.status(500).json({
        success: false,
        error: "Unable to approve review."
      });
    }
  }
);


/* =========================
   ADMIN - REJECT REVIEW
   ========================= */

app.patch(
  "/admin/api/reviews/:id/reject",
  requireAdmin,
  async (req, res) => {

    try {

      const review = await Review.findByIdAndUpdate(
        req.params.id,
        {
          status: "rejected"
        },
        {
          new: true
        }
      );

      if (!review) {
        return res.status(404).json({
          success: false,
          error: "Review not found."
        });
      }

      res.json({
        success: true,
        message: "Review rejected.",
        review
      });

    } catch (err) {

      console.error("Reject review error:", err);

      res.status(500).json({
        success: false,
        error: "Unable to reject review."
      });
    }
  }
);

/* =========================
   DELETE CUSTOMER REVIEW
   ========================= */

app.delete(
  "/admin/api/reviews/:id",
  requireAdmin,
  async (req, res) => {
    try {

      const review =
        await Review.findByIdAndDelete(
          req.params.id
        );

      if (!review) {
        return res.status(404).json({
          success: false,
          error: "Review not found."
        });
      }

      console.log(
        `🗑️ Review deleted: ${review._id}`
      );

      return res.json({
        success: true,
        message: "Review deleted successfully."
      });

    } catch (err) {

      console.error(
        "Delete review error:",
        err
      );

      return res.status(500).json({
        success: false,
        error: "Unable to delete review."
      });
    }
  }
);

/* =========================
   ADMIN - CHECK SESSION
   ========================= */

app.get("/admin/session", (req, res) => {

  res.json({
    authenticated:
      req.session &&
      req.session.isAdmin === true
  });
});

/* =========================
   ADMIN PAGE ROUTES
   ========================= */

app.get("/admin-login.html", (req, res) => {

  res.sendFile(
    path.join(__dirname, "admin-login.html")
  );

});


app.get("/admin-reviews.html", (req, res) => {

  if (
    !req.session ||
    req.session.isAdmin !== true
  ) {
    return res.redirect("/admin-login.html");
  }

  res.sendFile(
    path.join(__dirname, "admin-reviews.html")
  );

});

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
   HEALTH CHECK
   ========================= */

app.get("/health", (req, res) => {
  const dbConnected =
    mongoose.connection.readyState === 1;

  if (!dbConnected) {
    return res.status(503).json({
      status: "unhealthy",
      database: "disconnected"
    });
  }

  return res.status(200).json({
    status: "healthy",
    database: "connected"
  });
});
/* =========================
   SERVER START
   ========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
