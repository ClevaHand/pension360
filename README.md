# Pension360

A modern retirement experience platform for Nigeria — planning, verification, support and voluntary contributions in one place.

This project includes:

- **Public marketing site** (`index.html`)
- **Auth** (register / sign-in)
- **Member workspace** (dashboard, planning, verification, support, profile)
- **Payments demo** (provider selection + payment intents — no real card processing)
- **TypeScript/Express API** with JWT auth, optional PostgreSQL, or zero-config in-memory store

> Demo / prototype only. Not a licensed PFA. Projections are estimates. Do not process real pension money or store real card data.

---

## Quick start (no Docker required)

**Requirements:** Node.js 18+

```bash
cd pension360

# 1. Install dependencies
npm install

# 2. Run the app (API + frontend on one port)
npm run serve
```

Open:

```text
http://127.0.0.1:4000
```

| Page | URL |
|------|-----|
| Landing | http://127.0.0.1:4000/ |
| Sign in / Register | http://127.0.0.1:4000/auth.html |
| Workspace | http://127.0.0.1:4000/dashboard.html |
| Health | http://127.0.0.1:4000/health |

That’s it. Data is stored in memory for the session. Restarting the process clears demo accounts.

### Development mode (auto-reload)

```bash
npm run dev
```

### Production-style start

```bash
npm run build
npm start
```

---

## Optional: PostgreSQL

If you want durable storage:

1. Start Postgres (example with Docker):

```bash
docker compose up -d postgres
```

2. Uncomment `DATABASE_URL` in `.env`:

```env
DATABASE_URL=postgres://pension360:pension360@localhost:5432/pension360
```

3. Apply schema and run:

```bash
npm run db:init
npm run serve
```

If Postgres is unreachable, the API automatically falls back to the in-memory store.

---

## Environment

Copy from `.env.example` if needed. Important variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP port |
| `JWT_SECRET` | (dev secret) | Change before any shared deployment |
| `DATABASE_URL` | *(unset)* | Omit for in-memory; set for Postgres |
| `FRONTEND_ORIGIN` | `*` | CORS origins (`*` is fine for local demo) |
| `UPLOAD_DIR` | `uploads` | Local verification document storage |

---

## API overview

Authenticated routes need:

```http
Authorization: Bearer <jwt>
```

| Method | Route | Notes |
|--------|-------|--------|
| `POST` | `/api/auth/register` | `{ fullName, email, password }` (password ≥ 8 chars) |
| `POST` | `/api/auth/login` | `{ email, password }` |
| `GET` | `/api/me` | Current member |
| `PATCH` | `/api/profile` | Update profile fields |
| `POST` | `/api/verification/documents` | Multipart: `document` + `documentType` |
| `GET` | `/api/verification/documents` | List uploads |
| `GET` | `/api/planning/forecast` | Demo retirement estimate |
| `POST` | `/api/support/cases` | Create support case |
| `GET` | `/api/support/cases` | List cases |
| `POST` | `/api/payments/intents` | `{ provider, amountNaira }` — **no card data** |
| `GET` | `/health` | Liveness + storage mode |

Payment providers accepted: `paystack`, `flutterwave`, `remita`, `interswitch`.

---

## Project layout

```text
pension360/
├── index.html, auth.html, dashboard.html, …
├── styles.css, script.js
├── src/
│   ├── server.ts      # Express app (serves API + static files)
│   ├── auth.ts        # JWT helpers
│   └── db.ts          # Postgres or in-memory store
├── scripts/init-db.ts
├── db/schema.sql
├── docker-compose.yml # Optional Postgres
├── package.json
└── .env
```

---

## How to try the flows

1. Open http://127.0.0.1:4000 → **Get started**
2. Register with name, email, password (8+ characters)
3. You land on the workspace dashboard
4. Try **Verification** (upload a small JPG/PNG/PDF ≤ 5 MB)
5. Try **Payments** → choose a provider → submit amount (demo intent only)
6. **Sign out** from the sidebar

---

## Deploy notes

- Single process: Express serves both API and static HTML.
- Set a strong `JWT_SECRET`.
- Prefer Postgres + object storage for real uploads.
- Never accept raw card numbers; always use provider-hosted checkout.
- Put TLS termination (nginx, Caddy, cloud load balancer) in front of the app.
- Restrict `FRONTEND_ORIGIN` in production.

```bash
npm run build
PORT=4000 JWT_SECRET=your-long-secret node dist/src/server.js
```

---

## Security boundaries (prototype)

- Passwords are bcrypt-hashed.
- JWT sessions (7-day expiry).
- Helmet headers, rate limiting, Zod validation.
- Uploads limited to 5 MB, JPG/PNG/PDF only.
- Card fields on the payment page are UI-only; the API never stores them.

---

## License / status

Private prototype for demonstration and UX validation. Not for production pension or financial data without regulatory and security review.
