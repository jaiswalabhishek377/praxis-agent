import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import initSqlJs, { Database } from 'sql.js';

// ─── Configuration ──────────────────────────────────────────────
const PORT = parseInt(process.env.ERP_PORT || '3001');
const CHAOS_VALIDATION = process.env.CHAOS_VALIDATION === 'true';
const CHAOS_SESSION = process.env.CHAOS_SESSION === 'true';
const CHAOS_FLAKY = process.env.CHAOS_FLAKY === 'true';

const VALID_USER = 'admin';
const VALID_PASS = 'admin123';
const SESSION_TOKEN = 'erp-session-active';

// ─── Database Setup (in-memory SQLite via sql.js) ───────────────
let db: Database;

async function initDB() {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_name TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      due_date TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    )
  `);
  console.log('[ERP DB] SQLite initialized — vouchers table ready');
}

// ─── Express App ────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─── Chaos: Session tracking ───────────────────────────────────
let requestCount = 0;
let sessionInvalidated = false;

// ─── Chaos: Flaky button tracking ──────────────────────────────
let submitAttempts = 0;

// ─── Auth Middleware ────────────────────────────────────────────
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Chaos: Session expiry — invalidate after 3 authenticated requests
  if (CHAOS_SESSION && !sessionInvalidated) {
    requestCount++;
    if (requestCount > 3) {
      res.clearCookie('session');
      sessionInvalidated = true; // Only trigger once
      return res.redirect('/login');
    }
  }

  const session = req.cookies?.session;
  if (session !== SESSION_TOKEN) {
    return res.redirect('/login');
  }
  next();
}

// ─── Routes ─────────────────────────────────────────────────────

// Root → redirect to login
app.get('/', (_req, res) => {
  res.redirect('/login');
});

// Login page
app.get('/login', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Enterprise ERP - Login</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .login-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 400px; }
        h1 { color: #1a1a2e; margin-bottom: 8px; font-size: 24px; }
        .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
        label { display: block; margin-bottom: 4px; font-weight: 600; color: #333; font-size: 14px; }
        input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
        input:focus { outline: none; border-color: #4a90d9; box-shadow: 0 0 0 3px rgba(74,144,217,0.1); }
        button { width: 100%; padding: 12px; background: #4a90d9; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
        button:hover { background: #3a7bc8; }
        .error { background: #fee; color: #c00; padding: 10px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; display: none; }
      </style>
    </head>
    <body>
      <div class="login-card">
        <h1>Enterprise ERP Portal</h1>
        <p class="subtitle">Vendor Billing & Operations System</p>
        <div class="error" id="error-banner"></div>
        <form method="POST" action="/login">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" placeholder="Enter username" required>
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="Enter password" required>
          <button type="submit">Sign In</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Login handler
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === VALID_USER && password === VALID_PASS) {
    res.cookie('session', SESSION_TOKEN, { httpOnly: true });
    // Reset chaos counters on successful login
    requestCount = 0;
    sessionInvalidated = false;
    return res.redirect('/voucher');
  }
  res.status(401).send(`
    <!DOCTYPE html>
    <html><head><title>Login Failed</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; }
      .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
      .error { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; }
      a { color: #4a90d9; text-decoration: none; font-weight: 600; }
    </style>
    </head><body>
      <div class="card">
        <div class="error">Invalid username or password</div>
        <a href="/login">← Back to Login</a>
      </div>
    </body></html>
  `);
});

// Voucher entry form (requires auth)
app.get('/voucher', requireAuth, (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Enterprise ERP - Voucher Entry</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: #f0f2f5; min-height: 100vh; }
        .header { background: #1a1a2e; color: white; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 18px; }
        .header a { color: #aaa; text-decoration: none; font-size: 14px; }
        .container { max-width: 600px; margin: 40px auto; padding: 0 20px; }
        .form-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h2 { color: #1a1a2e; margin-bottom: 24px; font-size: 20px; }
        label { display: block; margin-bottom: 4px; font-weight: 600; color: #333; font-size: 14px; }
        .hint { font-weight: 400; color: #888; font-size: 12px; }
        input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
        input:focus { outline: none; border-color: #4a90d9; box-shadow: 0 0 0 3px rgba(74,144,217,0.1); }
        button { width: 100%; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
        button:hover { background: #27ae60; }
        .error-banner { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; border: 1px solid #fcc; }
        .success-banner { background: #efd; color: #060; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; border: 1px solid #cec; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Enterprise ERP Portal</h1>
        <a href="/login">Logout</a>
      </div>
      <div class="container">
        <div class="form-card">
          <h2>New Vendor Voucher</h2>
          <form method="POST" action="/voucher">
            <label for="vendor_name">Vendor Name</label>
            <input type="text" id="vendor_name" name="vendor_name" placeholder="e.g. Apex Healthcare LLC" required>

            <label for="invoice_number">Invoice Number</label>
            <input type="text" id="invoice_number" name="invoice_number" placeholder="e.g. AH-7891" required>

            <label for="amount_usd">Amount (USD)</label>
            <input type="text" id="amount_usd" name="amount_usd" placeholder="e.g. 1450.00" required>

            <label for="due_date">Due Date <span class="hint">(MM/DD/YYYY)</span></label>
            <input type="text" id="due_date" name="due_date" placeholder="MM/DD/YYYY" required>

            <button type="submit">Submit Voucher</button>
          </form>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Voucher submission handler
app.post('/voucher', requireAuth, (req, res) => {
  const { vendor_name, invoice_number, amount_usd, due_date } = req.body || {};

  // ─── Required Field Validation ─────────────────────────────────
  const missing = ['vendor_name', 'invoice_number', 'amount_usd', 'due_date']
    .filter((f) => !req.body?.[f]?.toString().trim());
  if (missing.length > 0) {
    return res.status(400).send(`<h1>Error: Missing required fields: ${missing.join(', ')}</h1>`);
  }

  const parsedAmount = parseFloat(amount_usd);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).send(`<h1>Error: Invalid amount "${amount_usd}". Must be a positive number.</h1>`);
  }

  // ─── Chaos: Validation mismatch ──────────────────────────────
  if (CHAOS_VALIDATION) {
    const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = due_date.match(dateRegex);
    // Check format AND actual date validity (month 1-12, valid day for month)
    const isValidDate = (() => {
      if (!match) return false;
      const [, mm, dd, yyyy] = match;
      const month = parseInt(mm, 10);
      const day = parseInt(dd, 10);
      const year = parseInt(yyyy, 10);
      if (month < 1 || month > 12) return false;
      // Use JS Date to validate day-in-month (handles leap years too)
      const testDate = new Date(year, month - 1, day);
      return testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day;
    })();
    if (!isValidDate) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8"><title>Enterprise ERP - Voucher Entry</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
            body { background: #f0f2f5; min-height: 100vh; }
            .header { background: #1a1a2e; color: white; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
            .header h1 { font-size: 18px; }
            .container { max-width: 600px; margin: 40px auto; padding: 0 20px; }
            .form-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            h2 { color: #1a1a2e; margin-bottom: 24px; font-size: 20px; }
            label { display: block; margin-bottom: 4px; font-weight: 600; color: #333; font-size: 14px; }
            .hint { font-weight: 400; color: #888; font-size: 12px; }
            input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
            button { width: 100%; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
            .error-banner { background: #fee; color: #c00; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; border: 1px solid #fcc; }
          </style>
        </head>
        <body>
          <div class="header"><h1>Enterprise ERP Portal</h1></div>
          <div class="container">
            <div class="form-card">
              <h2>New Vendor Voucher</h2>
              <div class="error-banner">
                ⚠️ Validation Error: Due Date must be in MM/DD/YYYY format. You entered "${due_date}" which is not valid. Please correct the date format and resubmit.
              </div>
              <form method="POST" action="/voucher">
                <label for="vendor_name">Vendor Name</label>
                <input type="text" id="vendor_name" name="vendor_name" value="${vendor_name}" required>
                <label for="invoice_number">Invoice Number</label>
                <input type="text" id="invoice_number" name="invoice_number" value="${invoice_number}" required>
                <label for="amount_usd">Amount (USD)</label>
                <input type="text" id="amount_usd" name="amount_usd" value="${amount_usd}" required>
                <label for="due_date">Due Date <span class="hint">(MM/DD/YYYY)</span></label>
                <input type="text" id="due_date" name="due_date" value="${due_date}" required>
                <button type="submit">Submit Voucher</button>
              </form>
            </div>
          </div>
        </body>
        </html>
      `);
    }
  }

  // ─── Chaos: Flaky submit button ──────────────────────────────
  if (CHAOS_FLAKY) {
    submitAttempts++;
    if (submitAttempts === 1) {
      // First attempt fails silently — returns the form again with no change
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8"><title>Enterprise ERP - Voucher Entry</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
            body { background: #f0f2f5; min-height: 100vh; }
            .header { background: #1a1a2e; color: white; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
            .header h1 { font-size: 18px; }
            .container { max-width: 600px; margin: 40px auto; padding: 0 20px; }
            .form-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            h2 { color: #1a1a2e; margin-bottom: 24px; font-size: 20px; }
            label { display: block; margin-bottom: 4px; font-weight: 600; color: #333; font-size: 14px; }
            .hint { font-weight: 400; color: #888; font-size: 12px; }
            input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
            button { width: 100%; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
            .error-banner { background: #fff3e0; color: #e65100; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; border: 1px solid #ffcc80; }
          </style>
        </head>
        <body>
          <div class="header"><h1>Enterprise ERP Portal</h1></div>
          <div class="container">
            <div class="form-card">
              <h2>New Vendor Voucher</h2>
              <div class="error-banner">
                ⚠️ Submission failed: Server did not respond. Please try submitting again.
              </div>
              <form method="POST" action="/voucher">
                <label for="vendor_name">Vendor Name</label>
                <input type="text" id="vendor_name" name="vendor_name" value="${vendor_name}" required>
                <label for="invoice_number">Invoice Number</label>
                <input type="text" id="invoice_number" name="invoice_number" value="${invoice_number}" required>
                <label for="amount_usd">Amount (USD)</label>
                <input type="text" id="amount_usd" name="amount_usd" value="${amount_usd}" required>
                <label for="due_date">Due Date <span class="hint">(MM/DD/YYYY)</span></label>
                <input type="text" id="due_date" name="due_date" value="${due_date}" required>
                <button type="submit">Submit Voucher</button>
              </form>
            </div>
          </div>
        </body>
        </html>
      `);
    }
  }

  // ─── Success: Insert into DB ──────────────────────────────────
  const submittedAt = new Date().toISOString();

  db.run(
    `INSERT INTO vouchers (vendor_name, invoice_number, amount_usd, due_date, submitted_at) VALUES (?, ?, ?, ?, ?)`,
    [vendor_name, invoice_number, parsedAmount, due_date, submittedAt]
  );

  console.log(`[ERP] Voucher submitted: ${vendor_name} | ${invoice_number} | $${parsedAmount} | ${due_date}`);

  // Reset flaky counter
  submitAttempts = 0;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>Enterprise ERP - Success</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: #f0f2f5; min-height: 100vh; }
        .header { background: #1a1a2e; color: white; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 18px; }
        .header a { color: #aaa; text-decoration: none; font-size: 14px; }
        .container { max-width: 600px; margin: 40px auto; padding: 0 20px; }
        .success-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
        .success-icon { font-size: 48px; margin-bottom: 16px; }
        h2 { color: #27ae60; margin-bottom: 12px; }
        .detail { color: #666; font-size: 14px; margin-bottom: 8px; }
        .detail strong { color: #333; }
        a.btn { display: inline-block; margin-top: 20px; padding: 10px 24px; background: #4a90d9; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Enterprise ERP Portal</h1>
        <a href="/login">Logout</a>
      </div>
      <div class="container">
        <div class="success-card">
          <div class="success-icon">✅</div>
          <h2>Voucher Submitted Successfully</h2>
          <p class="detail"><strong>Vendor:</strong> ${vendor_name}</p>
          <p class="detail"><strong>Invoice:</strong> ${invoice_number}</p>
          <p class="detail"><strong>Amount:</strong> $${parsedAmount.toFixed(2)}</p>
          <p class="detail"><strong>Due Date:</strong> ${due_date}</p>
          <p class="detail"><strong>Submitted:</strong> ${submittedAt}</p>
          <a href="/voucher" class="btn">Submit Another Voucher</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ─── Hidden State Endpoint (for Independent Verifier) ───────────
// The agent should NEVER know about this. Only the verifier uses it.
app.get('/__state', (_req, res) => {
  const results = db.exec('SELECT * FROM vouchers ORDER BY id DESC');
  
  if (results.length === 0 || results[0].values.length === 0) {
    return res.json({ vouchers: [], count: 0 });
  }

  const columns = results[0].columns;
  const vouchers = results[0].values.map((row: any[]) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
    return obj;
  });

  res.json({ vouchers, count: vouchers.length });
});

// ─── Health Check ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'erp-portal', port: PORT, chaos: { CHAOS_VALIDATION, CHAOS_SESSION, CHAOS_FLAKY } });
});

// ─── Start Server ───────────────────────────────────────────────
async function main() {
  await initDB();
  
  app.listen(PORT, () => {
    console.log(`\n[ERP Portal] ✅ Running at http://localhost:${PORT}`);
    console.log(`[ERP Portal] Login: username=${VALID_USER} password=${VALID_PASS}`);
    console.log(`[ERP Portal] Chaos modes: validation=${CHAOS_VALIDATION} session=${CHAOS_SESSION} flaky=${CHAOS_FLAKY}`);
    console.log(`[ERP Portal] Hidden state: GET http://localhost:${PORT}/__state\n`);
  });
}

main().catch(console.error);
