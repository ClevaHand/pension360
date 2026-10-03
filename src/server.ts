import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { z } from "zod";
import {
  initDb,
  closeDb,
  isPostgres,
  findUserByEmail,
  createUser,
  findUserById,
  updateUser,
  createDocument,
  listDocumentsByUser,
  createSupportCase,
  listSupportCasesByUser,
  createPaymentIntent,
  writeAudit,
  publicUser
} from "./db";
import { signToken, requireAuth, optionalAuth, AuthedRequest } from "./auth";

dotenv.config();

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
const JWT_SECRET = process.env.JWT_SECRET || "pension360-dev-secret-change-me";

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Serve frontend from project root
const PUBLIC_DIR = path.resolve(process.cwd());
app.use(express.static(PUBLIC_DIR, { index: "index.html", extensions: ["html"] }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    storage: isPostgres() ? "postgres" : "memory",
    time: new Date().toISOString()
  });
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await findUserByEmail(body.email);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const password_hash = await bcrypt.hash(body.password, 10);
    const user = await createUser({
      email: body.email,
      password_hash,
      full_name: body.fullName
    });
    await writeAudit(user.id, "register");
    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await findUserByEmail(body.email);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    const match = await bcrypt.compare(body.password, user.password_hash);
    if (!match) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    await writeAudit(user.id, "login");
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Sign-in failed." });
  }
});

app.get("/api/me", requireAuth, async (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  rsaReference: z.string().trim().max(80).nullable().optional(),
  pfaName: z.string().trim().max(120).nullable().optional(),
  dateOfBirth: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional()
});

app.patch("/api/profile", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = profileSchema.parse(req.body);
    const user = await updateUser(req.userId!, {
      full_name: body.fullName,
      rsa_reference: body.rsaReference,
      pfa_name: body.pfaName,
      date_of_birth: body.dateOfBirth,
      phone: body.phone
    });
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    await writeAudit(user.id, "profile_update");
    res.json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Profile update failed." });
  }
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error("Only JPG, PNG or PDF files are allowed."));
  }
});

app.post(
  "/api/verification/documents",
  requireAuth,
  (req, res, next) => {
    upload.single("document")(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message || "Upload failed." });
        return;
      }
      next();
    });
  },
  async (req: AuthedRequest, res) => {
    try {
      const documentType = String(req.body.documentType || "");
      if (!["government_id", "rsa_evidence"].includes(documentType)) {
        res.status(400).json({ error: "documentType must be government_id or rsa_evidence." });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "A document file is required." });
        return;
      }
      const doc = await createDocument({
        user_id: req.userId!,
        document_type: documentType as "government_id" | "rsa_evidence",
        original_name: req.file.originalname,
        stored_name: req.file.filename,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size
      });
      await writeAudit(req.userId!, "document_upload", { documentType, name: req.file.originalname });
      res.status(201).json({
        document: {
          id: doc.id,
          documentType: doc.document_type,
          originalName: doc.original_name,
          status: doc.status,
          createdAt: doc.created_at
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Document upload failed." });
    }
  }
);

app.get("/api/verification/documents", requireAuth, async (req: AuthedRequest, res) => {
  const docs = await listDocumentsByUser(req.userId!);
  res.json({
    documents: docs.map((d) => ({
      id: d.id,
      documentType: d.document_type,
      originalName: d.original_name,
      status: d.status,
      sizeBytes: d.size_bytes,
      createdAt: d.created_at
    }))
  });
});

app.get("/api/planning/forecast", requireAuth, async (req: AuthedRequest, res) => {
  const user = await findUserById(req.userId!);
  const monthlyContribution = 85000;
  const yearsToRetirement = 25;
  const annualReturn = 0.1;
  let balance = 2_400_000;
  for (let y = 0; y < yearsToRetirement; y++) {
    balance = balance * (1 + annualReturn) + monthlyContribution * 12;
  }
  res.json({
    projectedBalanceNaira: Math.round(balance),
    monthlyContributionNaira: monthlyContribution,
    targetRetirementAge: 60,
    readinessPercent: 72,
    disclaimer: "Estimates only. Not a guarantee of future returns or pension benefits.",
    memberName: user?.full_name ?? null
  });
});

const caseSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(5).max(5000)
});

app.post("/api/support/cases", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const body = caseSchema.parse(req.body);
    const c = await createSupportCase({
      user_id: req.userId!,
      subject: body.subject,
      body: body.body
    });
    await writeAudit(req.userId!, "support_case_created", { id: c.id });
    res.status(201).json({
      case: {
        id: c.id,
        subject: c.subject,
        body: c.body,
        status: c.status,
        createdAt: c.created_at
      }
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create support case." });
  }
});

app.get("/api/support/cases", requireAuth, async (req: AuthedRequest, res) => {
  const cases = await listSupportCasesByUser(req.userId!);
  res.json({
    cases: cases.map((c) => ({
      id: c.id,
      subject: c.subject,
      body: c.body,
      status: c.status,
      createdAt: c.created_at,
      updatedAt: c.updated_at
    }))
  });
});

const paymentSchema = z.object({
  provider: z.enum(["paystack", "flutterwave", "remita", "interswitch"]),
  amountNaira: z.number().min(100).max(50_000_000),
  purpose: z.string().trim().max(100).optional()
});

app.post("/api/payments/intents", optionalAuth, async (req: AuthedRequest, res) => {
  try {
    const body = paymentSchema.parse(req.body);
    const intent = await createPaymentIntent({
      user_id: req.userId ?? null,
      provider: body.provider,
      amount_naira: body.amountNaira,
      purpose: body.purpose || "voluntary_pension_contribution"
    });
    await writeAudit(req.userId ?? null, "payment_intent_created", {
      id: intent.id,
      provider: intent.provider,
      amount: intent.amount_naira
    });
    res.status(201).json({
      intentId: intent.id,
      provider: intent.provider,
      amountNaira: intent.amount_naira,
      status: intent.status,
      nextStep:
        `Demo intent ${intent.id.slice(0, 8)} created for ₦${intent.amount_naira.toLocaleString("en-NG")} via ${intent.provider}. ` +
        "In production you would be redirected to the provider's PCI-compliant hosted checkout. No card data was stored."
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Could not create payment intent." });
  }
});

app.post("/api/webhooks/:provider", (_req, res) => {
  res.status(501).json({
    error: "Provider webhooks are not enabled in this prototype. Configure signed webhooks before going live."
  });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  const file = path.join(PUBLIC_DIR, req.path.endsWith(".html") ? req.path : `${req.path}.html`);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.sendFile(file);
    return;
  }
  next();
});

async function main() {
  const mode = await initDb(process.env.DATABASE_URL);
  if (
    JWT_SECRET === "replace-with-a-long-random-secret" ||
    JWT_SECRET === "pension360-dev-secret-change-me"
  ) {
    console.warn("[security] Using a default JWT secret. Set JWT_SECRET in .env for anything beyond local demo.");
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Pension360 running at http://127.0.0.1:${PORT}`);
    console.log(`Storage: ${mode}`);
    console.log(`Health:  http://127.0.0.1:${PORT}/health`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await closeDb();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeDb();
  process.exit(0);
});
