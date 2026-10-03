import { Pool, QueryResult, QueryResultRow } from "pg";
import { randomUUID } from "crypto";

export type Role = "member" | "support_agent" | "admin";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: Role;
  rsa_reference: string | null;
  pfa_name: string | null;
  date_of_birth: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerificationDocument {
  id: string;
  user_id: string;
  document_type: "government_id" | "rsa_evidence";
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface SupportCase {
  id: string;
  user_id: string;
  subject: string;
  body: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  created_at: string;
  updated_at: string;
}

export interface PaymentIntent {
  id: string;
  user_id: string | null;
  provider: "paystack" | "flutterwave" | "remita" | "interswitch";
  amount_naira: number;
  purpose: string;
  status: "created" | "redirected" | "paid" | "failed" | "cancelled";
  created_at: string;
}

/** Simple in-memory store so the app runs with zero infrastructure. */
class MemoryStore {
  users = new Map<string, User>();
  usersByEmail = new Map<string, string>();
  documents = new Map<string, VerificationDocument>();
  cases = new Map<string, SupportCase>();
  payments = new Map<string, PaymentIntent>();
  audit: { id: string; user_id: string | null; action: string; meta: unknown; created_at: string }[] = [];
}

const memory = new MemoryStore();

let pool: Pool | null = null;
let usePostgres = false;

export async function initDb(databaseUrl?: string): Promise<"postgres" | "memory"> {
  if (!databaseUrl) {
    usePostgres = false;
    return "memory";
  }

  try {
    pool = new Pool({ connectionString: databaseUrl, max: 10 });
    await pool.query("SELECT 1");
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    } catch {
      /* ignore if not superuser */
    }
    usePostgres = true;
    return "postgres";
  } catch (err) {
    console.warn("[db] PostgreSQL unavailable, using in-memory store:", (err as Error).message);
    if (pool) {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      pool = null;
    }
    usePostgres = false;
    return "memory";
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function isPostgres(): boolean {
  return usePostgres;
}

async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (!pool) throw new Error("PostgreSQL pool not initialized");
  return pool.query<T>(text, params);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = email.toLowerCase().trim();
  if (usePostgres) {
    const res = await query<User>("SELECT * FROM users WHERE email = $1", [normalized]);
    return res.rows[0] ?? null;
  }
  const id = memory.usersByEmail.get(normalized);
  return id ? memory.users.get(id) ?? null : null;
}

export async function findUserById(id: string): Promise<User | null> {
  if (usePostgres) {
    const res = await query<User>("SELECT * FROM users WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  }
  return memory.users.get(id) ?? null;
}

export async function createUser(input: {
  email: string;
  password_hash: string;
  full_name: string;
  role?: Role;
}): Promise<User> {
  const email = input.email.toLowerCase().trim();
  const now = new Date().toISOString();

  if (usePostgres) {
    const res = await query<User>(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email, input.password_hash, input.full_name, input.role ?? "member"]
    );
    return res.rows[0];
  }

  const user: User = {
    id: randomUUID(),
    email,
    password_hash: input.password_hash,
    full_name: input.full_name,
    role: input.role ?? "member",
    rsa_reference: null,
    pfa_name: null,
    date_of_birth: null,
    phone: null,
    created_at: now,
    updated_at: now
  };
  memory.users.set(user.id, user);
  memory.usersByEmail.set(email, user.id);
  return user;
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, "full_name" | "rsa_reference" | "pfa_name" | "date_of_birth" | "phone">>
): Promise<User | null> {
  if (usePostgres) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push(value);
      }
    }
    if (!fields.length) return findUserById(id);
    fields.push(`updated_at = NOW()`);
    values.push(id);
    const res = await query<User>(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  }

  const user = memory.users.get(id);
  if (!user) return null;
  Object.assign(user, patch, { updated_at: new Date().toISOString() });
  memory.users.set(id, user);
  return user;
}

export async function createDocument(
  input: Omit<VerificationDocument, "id" | "status" | "created_at">
): Promise<VerificationDocument> {
  const now = new Date().toISOString();
  if (usePostgres) {
    const res = await query<VerificationDocument>(
      `INSERT INTO verification_documents
         (user_id, document_type, original_name, stored_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.user_id, input.document_type, input.original_name, input.stored_name, input.mime_type, input.size_bytes]
    );
    return res.rows[0];
  }

  const doc: VerificationDocument = {
    id: randomUUID(),
    ...input,
    status: "pending",
    created_at: now
  };
  memory.documents.set(doc.id, doc);
  return doc;
}

export async function listDocumentsByUser(userId: string): Promise<VerificationDocument[]> {
  if (usePostgres) {
    const res = await query<VerificationDocument>(
      "SELECT * FROM verification_documents WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return res.rows;
  }
  return [...memory.documents.values()]
    .filter((d) => d.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createSupportCase(input: {
  user_id: string;
  subject: string;
  body: string;
}): Promise<SupportCase> {
  const now = new Date().toISOString();
  if (usePostgres) {
    const res = await query<SupportCase>(
      `INSERT INTO support_cases (user_id, subject, body) VALUES ($1, $2, $3) RETURNING *`,
      [input.user_id, input.subject, input.body]
    );
    return res.rows[0];
  }
  const c: SupportCase = {
    id: randomUUID(),
    user_id: input.user_id,
    subject: input.subject,
    body: input.body,
    status: "open",
    created_at: now,
    updated_at: now
  };
  memory.cases.set(c.id, c);
  return c;
}

export async function listSupportCasesByUser(userId: string): Promise<SupportCase[]> {
  if (usePostgres) {
    const res = await query<SupportCase>(
      "SELECT * FROM support_cases WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return res.rows;
  }
  return [...memory.cases.values()]
    .filter((c) => c.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createPaymentIntent(input: {
  user_id: string | null;
  provider: PaymentIntent["provider"];
  amount_naira: number;
  purpose: string;
}): Promise<PaymentIntent> {
  const now = new Date().toISOString();
  if (usePostgres) {
    const res = await query<PaymentIntent>(
      `INSERT INTO payment_intents (user_id, provider, amount_naira, purpose)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.user_id, input.provider, input.amount_naira, input.purpose]
    );
    const row = res.rows[0];
    return { ...row, amount_naira: Number(row.amount_naira) };
  }
  const p: PaymentIntent = {
    id: randomUUID(),
    user_id: input.user_id,
    provider: input.provider,
    amount_naira: input.amount_naira,
    purpose: input.purpose,
    status: "created",
    created_at: now
  };
  memory.payments.set(p.id, p);
  return p;
}

export async function writeAudit(userId: string | null, action: string, meta?: unknown): Promise<void> {
  if (usePostgres) {
    await query(
      `INSERT INTO audit_logs (user_id, action, meta) VALUES ($1, $2, $3)`,
      [userId, action, meta ? JSON.stringify(meta) : null]
    );
    return;
  }
  memory.audit.push({
    id: randomUUID(),
    user_id: userId,
    action,
    meta: meta ?? null,
    created_at: new Date().toISOString()
  });
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    rsaReference: user.rsa_reference,
    pfaName: user.pfa_name,
    dateOfBirth: user.date_of_birth,
    phone: user.phone,
    createdAt: user.created_at
  };
}
