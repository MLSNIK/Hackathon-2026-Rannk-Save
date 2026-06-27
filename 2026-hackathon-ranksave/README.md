# RankSave

> **2026 Interledger Foundation Hackathon submission**
> Retirement savings for South Africa's informal workforce, one payment at a time.


## What is RankSave?

South Africa's ~11 million informal workers (spaza operators, domestic workers, street vendors) have no employer pension and no path into traditional retirement products. **RankSave** fixes that by turning every payment into a savings event: a configurable percentage of each outgoing transaction is automatically swept to the user's own savings wallet via a live Interledger payment, with zero extra steps. Set a save percentage once, forget it, and watch the balance grow. If funds run low the payment goes through and the save is skipped: no overdraft, no failed transaction. Disbursements follow SA's 2024 Two-Pot legislation, and a 30-year projection (Allan Gray Equity Fund, 11% p.a.) shows users exactly what consistent saving is worth.


## Features

| Feature | Description |
|---------|-------------|
| **Auto-Save** | A configurable % of every outgoing payment is swept to the user's savings wallet via a second Open Payments transaction in the same GNAP consent flow |
| **My Bag** | View total savings balance and a full contribution history, pulled from the savings wallet's completed incoming payments |
| **Futures** | 30-year Chart.js projection at 11% p.a. (Allan Gray Equity Fund); pre-fills monthly contribution from the user's real spending history; shows a comfort threshold line (R6 000/month for 25 years at 7% drawdown ≈ R849 000 nest egg) |
| **Disbursement** | Two-Pot System: lump-sum withdrawal (real ILP payment from savings wallet → spending wallet), monthly annuity projection, age-gated retirement pot |
| **Rewards** | Monthly partner voucher game (card-flip reveal, one play per month); year-end R500 Shoprite voucher for users who go the full year without a lump-sum withdrawal |
| **Shop** | Marketplace of stores that accept Open Payments |
| **Payment Requests** | Pull-side payments ask another user to send you money |


## Quick Start

### Prerequisites

- **Node.js 20+** and **npm 10+**
- An account at [wallet.interledger-test.dev](https://wallet.interledger-test.dev) with at least **two wallet addresses** created (one for spending, one for savings)
- A key pair generated and uploaded to your testnet account (**Settings → Developer Keys → Add Key**)

### 1. Clone and install

```bash
git clone <repo-url> ranksave
cd ranksave
npm install
```

This is an npm workspace one `npm install` at the root installs all packages for both `backend/` and `frontend/`.

### 2. Generate an Ed25519 private key

If you do not already have a key from the Developer Keys step:

```bash
cd backend
openssl genpkey -algorithm Ed25519 -out private.key
```

Upload the corresponding public key in the testnet dashboard (**Settings → Developer Keys → Add Key → Paste public key**). Copy the **Key ID** (a UUID) that the dashboard returns you will need it in the next step.

### 3. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in:

```env
PORT=3001
BACKEND_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173

# From wallet.interledger-test.dev the platform wallet that signs all requests
OP_WALLET_ADDRESS=https://ilp.interledger-test.dev/YOUR_HANDLE
OP_KEY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
OP_PRIVATE_KEY_PATH=./private.key

DB_PATH=./openremit.db
JWT_SECRET=replace-with-a-long-random-string
```

| Variable | Where to get it |
|----------|----------------|
| `OP_WALLET_ADDRESS` | Your wallet address URL from the testnet dashboard |
| `OP_KEY_ID` | The UUID shown after uploading your public key |
| `OP_PRIVATE_KEY_PATH` | Relative path from `backend/` to the `.key` file |
| `JWT_SECRET` | Any long random string; used to sign session tokens |

### 4. Configure the frontend

```bash
cp frontend/.env.example frontend/.env
```

The default value is correct for local development:

```env
VITE_BACKEND_URL=http://localhost:3001
```

Change this to your public backend URL when deploying.

### 5. Initialise the database

```bash
npm run db:push
```

This runs Drizzle Kit's `push` command, which creates (or migrates) the SQLite file at `backend/openremit.db`. No migration files are generated schema changes are always applied directly. Idempotent: safe to run more than once.

### 6. Start

```bash
npm run dev
```

This starts both processes concurrently:

- **Backend** → `http://localhost:3001` (tsx watch, hot-reloads on file save)
- **Frontend** → `http://localhost:5173` (Vite HMR)

Open [http://localhost:5173](http://localhost:5173) and sign up. After signing up, go to **Profile** and set your **Spending Wallet Address** (your main testnet wallet) and optionally your **Savings Wallet Address** (your second testnet wallet). Then enable auto-save and set a save percentage.


## The Open Payments Flow

Every payment in RankSave follows the GNAP (Grant Negotiation and Authorization Protocol) flow defined by the Open Payments specification. Auto-save adds a second, parallel transaction to the same user consent.

```
  Frontend                    Backend                         Open Payments Network
  ─────────────────────────   ────────────────────────────── ──────────────────────────
  1. User fills quote form     POST /api/remit/quote
     (recipient + amount)      ├─ walletAddress.get()        ── resolve both wallets
                               ├─ grant.request()            ── incoming-payment grant
                               ├─ incomingPayment.create()   ── create on receiver wallet
                               ├─ grant.request()            ── quote grant
                               ├─ quote.create()             ── price the send
                               │
                               │  if savingsEnabled:
                               ├─ incomingPayment.create()   ── FIXED_RECEIVE on savings wallet
                               └─ quote.create()             ── price the savings sweep

  2. User reviews quote        POST /api/remit/consent
     → clicks Authorise        ├─ grant.request()            ── interactive outgoing grant
                               └─ returns interactUrl             (covers BOTH quotes)

  3. Browser redirects ──────────────────────────────────────► Auth server consent screen
     to auth server                                                (user approves once)

  4. Auth server          ──►  GET /api/callback
     redirects back            ├─ grant.continue()           ── exchange interact_ref for token
                               ├─ outgoingPayment.create()   ── execute payment to recipient
                               ├─ outgoingPayment.create()   ── execute savings sweep
                               └─ redirect to frontend #/status

  5. Frontend polls            GET /api/remit/status/:id
     until COMPLETED
```

### Why FIXED_RECEIVE for savings

Savings sweeps use `FIXED_RECEIVE` (receiver specifies `incomingAmount`) rather than `FIXED_SEND`. This causes Rafiki to **auto-complete** the incoming payment the moment the exact amount arrives making the balance immediately visible in the testnet wallet UI. With `FIXED_SEND` (open-ended incoming payment), Rafiki keeps the IP open indefinitely and the balance shows as ZAR 0.00 until explicitly completed which requires a finalized grant the platform key cannot obtain for a user's separate savings wallet.


## Architecture

```
ranksave/
├── package.json                 ← workspace root; `npm run dev` starts everything
│
├── backend/
│   ├── src/
│   │   ├── index.ts             ← Express entry point; all routers mounted here
│   │   ├── config.ts            ← Reads and validates all env vars in one place
│   │   │
│   │   ├── db/
│   │   │   ├── schema.ts        ← Drizzle table definitions (see Database Schema)
│   │   │   └── index.ts         ← Drizzle + libsql (SQLite) singleton
│   │   │
│   │   ├── lib/
│   │   │   ├── openPayments.ts  ← SDK client singleton; start here for OP changes
│   │   │   ├── quoteFlow.ts     ← Shared: resolve wallets → incoming payment → quote
│   │   │   └── seedNews.ts      ← Seeds demo News articles on first boot (idempotent)
│   │   │
│   │   ├── routes/
│   │   │   ├── remit.ts         ← wallet-info / quote / consent / status / history
│   │   │   ├── callback.ts      ← GNAP redirect handler; runs savings sweep here
│   │   │   ├── savings.ts       ← GET /api/savings balance + contribution history
│   │   │   ├── auth.ts          ← signup / login / profile (JWT, bcrypt)
│   │   │   ├── users.ts         ← user search + public profiles
│   │   │   ├── requests.ts      ← payment requests ("asks") pull-side payments
│   │   │   └── news.ts          ← Web Monetisation news demo
│   │   │
│   │   └── middleware/
│   │       ├── requireAuth.ts   ← Bearer-token guard; sets req.user
│   │       └── errorHandler.ts
│   │
│   ├── examples/
│   │   └── p2p-open-payments-walkthrough.ts  ← Standalone SDK reference (no DB/server)
│   │
│   ├── drizzle.config.ts
│   └── private.key              ← Ed25519 private key (git-ignored)
│
└── frontend/
    ├── index.html               ← Shell: header, nav, #view mount point
    └── src/
        ├── main.ts              ← Hash router (#/remit, #/savings, …) boot here
        ├── api.ts               ← Typed fetch wrappers for every backend endpoint
        ├── auth.ts              ← JWT helpers (localStorage get/set/clear)
        ├── escape.ts            ← escapeHtml() must use for all user-supplied strings
        ├── money.ts             ← formatMoney() using Intl.NumberFormat
        ├── pointer.ts           ← Converts wallet URLs to $pointer shorthand
        ├── styles.css           ← Single stylesheet; edit :root vars to rebrand
        │
        └── views/
            ├── homeView.ts          ← Landing page (public + logged-in dashboard)
            ├── loginView.ts         ← JWT login
            ├── signupView.ts        ← Account creation
            ├── profileView.ts       ← Edit name, email, password, wallets, avatar
            ├── publicProfileView.ts ← Another user's profile + shared transactions
            ├── quoteView.ts         ← Step 1: recipient search + amount → quote
            ├── consentView.ts       ← Step 2: review quote, redirect to wallet
            ├── statusView.ts        ← Step 3: poll transaction until settled
            ├── historyView.ts       ← Full sent/received payment history
            ├── savingsView.ts       ← My Bag: total savings + contribution list
            ├── futuresView.ts       ← 30-year Chart.js projection + Allan Gray card
            ├── disbursementView.ts  ← Two-Pot System: lump-sum + monthly annuity
            ├── rewardsView.ts       ← Monthly voucher game + year-end reward
            ├── shopView.ts          ← Store directory
            ├── newsView.ts          ← Article grid (backend routes active; not in nav)
            └── newsArticleView.ts   ← Paywall + Web Monetisation streaming (not in nav)
```


## Database Schema

Five tables, all defined in `backend/src/db/schema.ts`. Run `npm run db:push` after any schema change.

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `crypto.randomUUID()` |
| `email` | text unique | Login credential |
| `password_hash` | text | bcryptjs, 10 rounds |
| `wallet_address` | text | Spending wallet (https:// URL) |
| `savings_wallet_address` | text | Second Interledger wallet for savings |
| `savings_percent` | integer | Whole percent, e.g. `10` = 10% |
| `savings_enabled` | boolean | Whether auto-save is active |

### `transactions`

| Column | Type | Notes |
|--------|------|-------|
| `status` | text | `PENDING → AWAITING_GRANT → COMPLETED \| FAILED` |
| `kind` | text | `PAYMENT` or `SAVINGS` |
| `payment_type` | text | `FIXED_SEND` or `FIXED_RECEIVE` |
| `parent_transaction_id` | text | For SAVINGS rows: the PAYMENT they rode along with |
| `grant_continue_uri/token/nonce` | text | GNAP continuation state, persisted between `/consent` and `/callback` |

### `payment_requests`

Pull-side "asks". Status: `PENDING → COMPLETED | DECLINED | CANCELLED`. A failed payment leaves the ask PENDING so the payer can retry. The OP flow runs fresh at fulfilment quotes and incoming payments expire, so nothing is pre-created.

### `posts` and `post_unlocks`

Backend infrastructure for the Web Monetisation news demo (seeded by `backend/src/lib/seedNews.ts`). The `/api/news/*` routes are still active and the views exist in `frontend/src/views/`, but the feature is not exposed in the app navigation.


## Key Technical Details

### Auto-save percentage calculation

In `backend/src/routes/remit.ts`, when the user has savings enabled:

```typescript
const savingsValue = Math.floor((totalDebit * user.savingsPercent) / 100);
```

The savings amount is calculated from the **total debit amount** (including the payment itself), then sent as a separate `FIXED_RECEIVE` outgoing payment to `user.savingsWalletAddress`.

### Futures projection

`frontend/src/views/futuresView.ts` uses two formulas:

**Future Value** (portfolio growth at 11% p.a. / 12 monthly):
```
FV = PV × (1 + r)^n  +  PMT × ((1 + r)^n − 1) / r
```

**Comfort nest egg** (live off savings for 25 years at 7% p.a. drawdown):
```
PV = PMT × (1 − (1 + r)^-n) / r
   = 6000 × (1 − (1 + 0.07/12)^-300) / (0.07/12)
   ≈ R849 000
```

The monthly contribution input is pre-filled from the user's **actual average monthly spending** computed from their payment history, not an arbitrary default.

### Disbursement (Two-Pot System)

`frontend/src/views/disbursementView.ts` mirrors the 2024 South African Two-Pot Retirement System legislation:

- **Savings Pot** (1/3 of balance) accessible once per year, minimum R2 000, taxed as income. Implemented as a real ILP payment from `savingsWalletAddress → walletAddress` using the standard GNAP flow.
- **Retirement Pot** (2/3 of balance) converts to a monthly annuity using `PMT = PV × r / (1 − (1 + r)^-n)`. UI is shown but the button is disabled until age 55 (enforced client-side for the demo).

### Rewards

`frontend/src/views/rewardsView.ts` uses `localStorage` for game state:

- `rs_monthly_YYYY-MM` stores whether the monthly card game was played and which prizes were assigned to which card positions. Resets each calendar month automatically (different key).
- `rs_year_YYYY` / `rs_year_YYYY_code` tracks whether the year-end R500 Shoprite voucher has been claimed. Voucher code is generated on first page load and stored so it remains stable across visits.


## API Reference

All routes require a `Bearer <token>` header unless marked public.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/signup` | public | Create account; returns `{ token, user }` |
| POST | `/api/auth/login` | public | Login; returns `{ token, user }` |
| GET | `/api/auth/me` | required | Current user profile |
| PATCH | `/api/auth/me` | required | Update name, email, password, wallet addresses, save settings, avatar |

### Payments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/remit/wallet-info?url=…` | Resolve a wallet address (currency, scale) |
| POST | `/api/remit/quote` | Step 1: create incoming payment + quote; returns quote details for UI |
| POST | `/api/remit/consent` | Step 2: request interactive outgoing grant; returns `interactUrl` |
| GET | `/api/callback` | Step 3 (GNAP redirect): execute outgoing payments, then redirect to frontend |
| GET | `/api/remit/status/:id` | Poll a transaction for `status` |
| GET | `/api/remit/history` | All sent/received transactions for the current user |

### Savings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/savings` | Total saved (sum of COMPLETED SAVINGS `debitAmount`) + contribution list |

### Payment Requests

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/requests` | Create a payment request (ask) |
| GET | `/api/requests` | `{ incoming, outgoing }` asks for the current user |
| POST | `/api/requests/:id/fulfill` | Payer starts fulfilment (runs quote flow, returns same shape as `/remit/quote`) |
| POST | `/api/requests/:id/decline` | Payer declines |
| POST | `/api/requests/:id/cancel` | Requester cancels |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/search?q=…` | Find users by display name |
| GET | `/api/users/:id` | Public profile + shared transaction history |

### News (backend only not in nav)

These routes remain active but the news section is not linked in the frontend navigation.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/news/posts` | Article list with per-reader `unlocked` flag |
| GET | `/api/news/posts/:id` | Article detail; body only returned when unlocked |
| POST | `/api/news/posts/:id/wm-unlock` | Record a Web Monetisation stream unlock |
| POST | `/api/news/posts/:id/unlock` | Open Payments fallback unlock (returns quote) |


## Available Scripts

Run all scripts from the **workspace root** unless otherwise noted.

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend (:3001) + frontend (:5173) with live reload |
| `npm run build` | Production build for both packages |
| `npm run db:push` | Apply schema changes to SQLite (no migration files) |
| `cd backend && npm run start` | Run the compiled backend in production |
| `cd frontend && npm run preview` | Preview the production frontend build |


## Environment Variables

### `backend/.env`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | no | `3001` | Port the Express server listens on |
| `BACKEND_URL` | yes | | Public URL of this backend; used to build the GNAP callback URL |
| `FRONTEND_URL` | yes | | Public URL of the frontend; used for CORS and post-callback redirect |
| `OP_WALLET_ADDRESS` | yes | | The platform wallet address that signs all Open Payments requests |
| `OP_KEY_ID` | yes | | UUID of the key uploaded to the Developer Keys section |
| `OP_PRIVATE_KEY_PATH` | yes | `./private.key` | Path to the Ed25519 `.key` file, relative to `backend/` |
| `DB_PATH` | no | `./openremit.db` | Path to the SQLite database file |
| `JWT_SECRET` | yes | | Secret for signing and verifying session tokens; use a long random string |

### `frontend/.env`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_BACKEND_URL` | no | `http://localhost:3001` | Backend API base URL, injected at build time by Vite |


## Extending the App

### Add a new page

1. Create `frontend/src/views/myPageView.ts` exporting `renderMyPageView(container: HTMLElement): Promise<void>`
2. Add a nav link in `frontend/index.html`: `<a href="#/mypage" class="nav-link" data-route="mypage">My Page</a>`
3. Add a route in `frontend/src/main.ts`: `if (path === '/mypage') { await renderMyPageView(view); return; }`

### Add a new API endpoint

1. Add a handler in `backend/src/routes/myRoute.ts`
2. Mount it in `backend/src/index.ts`: `app.use('/api/my', myRouter)`
3. Add a typed wrapper in `frontend/src/api.ts` so the frontend has a typed client

### Add a database column

1. Edit `backend/src/db/schema.ts`
2. Run `npm run db:push` Drizzle applies the change directly to SQLite

### Change the savings calculation

The savings amount is computed in `backend/src/routes/remit.ts` in the `POST /api/remit/quote` handler. The key line:

```typescript
const savingsValue = Math.floor((totalDebit * user.savingsPercent) / 100);
```

Modify this to round differently, cap the maximum, or apply a tiered rate.

### Deploy to production

1. Set `BACKEND_URL` to your public backend domain so the GNAP callback URL is reachable from the internet
2. Set `FRONTEND_URL` to your public frontend domain
3. Ensure `OP_PRIVATE_KEY_PATH` points to the key file on your server (or pull from a secrets manager)
4. Change `JWT_SECRET` to a cryptographically random 64-character string
5. Build: `npm run build` serve `frontend/dist/` as static files and run `backend/dist/index.js` with Node


## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing required environment variable: OP_WALLET_ADDRESS` | Copy `backend/.env.example` → `backend/.env` and fill in all values |
| Savings balance shows ZAR 0.00 in testnet wallet | Ensure `paymentType` is `FIXED_RECEIVE` for savings transactions in `remit.ts` this sets `incomingAmount` so Rafiki auto-completes the IP |
| `Grant continuation did not return an access token` | Consent was denied, expired, or the interact_ref was already used start over from the quote step |
| `Expected non-interactive incoming-payment grant` | The receiver's wallet requires interactive consent for incoming payments (rare on testnet) check the wallet's grant policy |
| Frontend shows network error | Check `VITE_BACKEND_URL` in `frontend/.env` and confirm the backend is running and CORS allows your frontend origin |
| `db:push` fails | Delete `backend/openremit.db` and re-run `npm run db:push` to start fresh (all data will be lost) |
| Key ID mismatch error from Open Payments SDK | `OP_KEY_ID` must exactly match the UUID shown in the testnet dashboard after uploading the public key |


## Open Payments SDK Reference

The standalone walkthrough in `backend/examples/p2p-open-payments-walkthrough.ts` runs the complete P2P flow without any web server or database code. It is kept in sync with the SDK patterns used in `quoteFlow.ts` and `callback.ts` and is a useful reference when modifying the payment logic.

```bash
cd backend
npx tsx examples/p2p-open-payments-walkthrough.ts
```

Key SDK patterns used throughout the codebase:

```typescript
// Singleton client (backend/src/lib/openPayments.ts)
const client = await createAuthenticatedClient({
  walletAddressUrl: config.opWalletAddress,
  keyId:            config.opKeyId,
  privateKey:       config.opPrivateKeyPath,   // file path SDK reads the .pem itself
});

// Resolve a wallet always do this before creating OP resources
const wallet = await client.walletAddress.get({ url: 'https://...' });
// wallet.authServer     → grant.request() calls
// wallet.resourceServer → incomingPayment / quote / outgoingPayment create() calls
// wallet.id             → walletAddress field in resource create() bodies

// Non-interactive grant (incoming payment, quote)
const grant = await client.grant.request(
  { url: wallet.authServer },
  { access_token: { access: [{ type: 'incoming-payment' }] } }
);

// Interactive grant (outgoing payment) requires user redirect
const pending = await client.grant.request(
  { url: senderWallet.authServer },
  {
    access_token: { access: [{ type: 'outgoing-payment', limits: { debitAmount: {...} } }] },
    interact: { start: ['redirect'], finish: { method: 'redirect', uri: callbackUrl, nonce } },
  }
);
// isPendingGrant(pending) === true
// → redirect user to pending.interact.redirect

// After GNAP callback
const final = await client.grant.continue(
  { url: pending.continue.uri, accessToken: pending.continue.access_token.value },
  { interact_ref }
);

// Execute payment (quoteId is the full URL returned by quote.create)
await client.outgoingPayment.create(
  { url: senderWallet.resourceServer, accessToken: final.access_token.value },
  { walletAddress: senderWallet.id, quoteId: quote.id }
);
```


## Built With

- [Interledger Open Payments SDK](https://github.com/interledger/open-payments) `@interledger/open-payments`
- [Interledger Test Wallet](https://wallet.interledger-test.dev) testnet wallet infrastructure (Rafiki)
- [Express](https://expressjs.com) backend HTTP server
- [Drizzle ORM](https://orm.drizzle.team) + [libsql](https://github.com/tursodatabase/libsql) SQLite via Drizzle
- [Vite](https://vitejs.dev) + vanilla TypeScript frontend (no framework)
- [Chart.js](https://www.chartjs.org) Futures projection chart


*RankSave 2026 Interledger Foundation Hackathon*
