require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const {
  getRazorpay,
  verifyCheckoutSignature,
  verifyWebhookSignature
} = require("./razorpay");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const publicDir = path.join(__dirname, "..", "public");
const dataDir = path.join(__dirname, "..", "data");
const applicationsFile = path.join(dataDir, "applications.json");
const webhookFile = path.join(dataDir, "webhooks.json");

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use("/api", rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  limit: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(applicationsFile)) fs.writeFileSync(applicationsFile, "{}", "utf8");
  if (!fs.existsSync(webhookFile)) fs.writeFileSync(webhookFile, "{}", "utf8");
}
ensureDataFiles();

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}
function cleanString(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
function makeId() {
  return `QL-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}
const ALLOWED_LOAN_TYPES = new Set(["personal", "home", "business"]);

app.post("/api/webhooks/razorpay",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    try {
      const signature = req.get("x-razorpay-signature");
      if (!verifyWebhookSignature(req.body, signature)) {
        return res.status(400).json({ error: "Invalid webhook signature." });
      }

      const event = JSON.parse(req.body.toString("utf8"));
      const eventId = req.get("x-razorpay-event-id") ||
        crypto.createHash("sha256").update(req.body).digest("hex");

      const events = readJson(webhookFile);
      if (events[eventId]) return res.json({ received: true, duplicate: true });

      events[eventId] = {
        eventId,
        event: event.event || null,
        payload: event,
        receivedAt: new Date().toISOString()
      };
      writeJson(webhookFile, events);
      return res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      return res.status(500).json({ error: "Webhook processing failed." });
    }
  }
);

app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => res.json({
  ok: true,
  service: "quick-loan-platform",
  environment: process.env.NODE_ENV || "development"
}));

app.get("/api/config", (req, res) => res.json({
  razorpay: {
    enabled: process.env.PAYMENT_ENABLED === "true",
    keyId: process.env.RAZORPAY_KEY_ID || "",
    currency: process.env.PAYMENT_CURRENCY || "INR",
    amountPaise: Number(process.env.PAYMENT_AMOUNT_PAISE || 0),
    description: process.env.PAYMENT_DESCRIPTION || ""
  }
}));

app.post("/api/applications", async (req, res) => {
  try {
    const {
      loanType, requestedAmount, tenureMonths, employmentType,
      monthlyIncome, fullName, phone, city, email, consent
    } = req.body || {};

    if (!ALLOWED_LOAN_TYPES.has(loanType)) return res.status(400).json({ error: "Invalid loan type." });

    const amount = Number(requestedAmount);
    const tenure = Number(tenureMonths);
    const income = Number(monthlyIncome);

    if (!Number.isFinite(amount) || amount < 1000 || amount > 10000000)
      return res.status(400).json({ error: "Invalid requested loan amount." });
    if (!Number.isInteger(tenure) || tenure < 1 || tenure > 360)
      return res.status(400).json({ error: "Invalid tenure." });
    if (!Number.isFinite(income) || income < 0 || income > 100000000)
      return res.status(400).json({ error: "Invalid income." });
    if (!consent) return res.status(400).json({ error: "Required consent was not provided." });

    const applicationId = makeId();
    const apps = readJson(applicationsFile);
    apps[applicationId] = {
      applicationId, loanType,
      requestedAmount: Math.round(amount),
      tenureMonths: tenure,
      employmentType: cleanString(employmentType, 80),
      monthlyIncome: Math.round(income),
      fullName: cleanString(fullName, 120),
      phone: cleanString(phone, 20),
      city: cleanString(city, 100),
      email: cleanString(email, 200).toLowerCase(),
      status: "payment_pending",
      paymentStatus: "not_paid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeJson(applicationsFile, apps);

    res.status(201).json({ success: true, applicationId, status: apps[applicationId].status });
  } catch (error) {
    console.error("Application error:", error);
    res.status(500).json({ error: "Unable to submit application." });
  }
});

app.get("/api/applications/:applicationId", async (req, res) => {
  const id = cleanString(req.params.applicationId, 100);
  const apps = readJson(applicationsFile);
  const data = apps[id];
  if (!data) return res.status(404).json({ error: "Application not found." });

  res.json({
    applicationId: id,
    status: data.status,
    paymentStatus: data.paymentStatus || "not_paid",
    loanType: data.loanType,
    requestedAmount: data.requestedAmount,
    tenureMonths: data.tenureMonths,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  });
});

app.post("/api/payments/create-order", async (req, res) => {
  try {
    if (process.env.PAYMENT_ENABLED !== "true")
      return res.status(403).json({ error: "Payments are currently disabled." });

    const amountPaise = Number(process.env.PAYMENT_AMOUNT_PAISE || 0);
    if (!Number.isInteger(amountPaise) || amountPaise !== 119900)
      return res.status(500).json({ error: "Payment configuration must be exactly ₹1,199." });

    const applicationId = cleanString(req.body?.applicationId, 100);
    const apps = readJson(applicationsFile);
    const application = apps[applicationId];
    if (!application) return res.status(404).json({ error: "Application not found." });

    if (application.paymentStatus === "paid")
      return res.status(409).json({ error: "Payment is already completed for this application." });

    const receipt = `ql_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const order = await getRazorpay().orders.create({
      amount: 119900,
      currency: "INR",
      receipt,
      notes: { applicationId }
    });

    application.paymentOrderId = order.id;
    application.paymentAmountPaise = 119900;
    application.paymentCurrency = "INR";
    application.updatedAt = new Date().toISOString();
    writeJson(applicationsFile, apps);

    res.json({
      orderId: order.id,
      amount: 119900,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      description: process.env.PAYMENT_DESCRIPTION || "Application service payment"
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ error: "Unable to create payment order." });
  }
});

app.post("/api/payments/verify", async (req, res) => {
  try {
    const { applicationId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
    if (!applicationId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature)
      return res.status(400).json({ error: "Incomplete payment verification data." });

    const apps = readJson(applicationsFile);
    const application = apps[cleanString(applicationId, 100)];
    if (!application) return res.status(404).json({ error: "Application not found." });
    if (application.paymentOrderId !== razorpayOrderId)
      return res.status(400).json({ error: "Order mismatch." });

    const valid = verifyCheckoutSignature({
      orderId: application.paymentOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature
    });
    if (!valid) return res.status(400).json({ error: "Payment signature verification failed." });

    const payment = await getRazorpay().payments.fetch(razorpayPaymentId);
    if (payment.order_id !== razorpayOrderId ||
        Number(payment.amount) !== 119900 ||
        payment.currency !== "INR") {
      return res.status(400).json({ error: "Payment amount, currency or order mismatch." });
    }

    application.paymentId = razorpayPaymentId;
    application.paymentStatus = payment.status === "captured" ? "paid" : payment.status;
    application.status = payment.status === "captured" ? "submitted" : "payment_pending";
    application.updatedAt = new Date().toISOString();
    writeJson(applicationsFile, apps);

    res.json({ success: true, paymentStatus: application.paymentStatus, status: application.status });
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({ error: "Unable to verify payment." });
  }
});

app.use(express.static(publicDir, { extensions: ["html"] }));
app.get("*splat", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found." });
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, () => console.log(`QuickLoan server listening on port ${PORT}`));
