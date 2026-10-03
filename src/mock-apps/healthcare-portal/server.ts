import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple in-memory session (no extra dependencies needed)
let isLoggedIn = false;
let currentChaos = {
  flaky: process.env.CHAOS_FLAKY === "true",
};

app.use(express.static(path.join(__dirname, "public")));

// DB
const db = { claims: [] as any[] };

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "dr_admin" && password === "health123") {
    isLoggedIn = true;
    return res.redirect("/claim");
  }
  res.redirect("/?error=Invalid credentials");
});

// Middleware
function requireAuth(_req: any, res: any, next: any) {
  if (!isLoggedIn) return res.redirect("/?error=Please login first");
  next();
}

// Form Page
app.get("/claim", requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "claim.html"));
});

// Submit Claim
let submitAttempts = 0;
app.post("/claim", requireAuth, (req, res) => {
  if (currentChaos.flaky) {
    submitAttempts++;
    if (submitAttempts % 2 !== 0) {
      return res.redirect("/claim?error=Server did not respond. Please try submitting again.");
    }
  }

  const { patient_id, treatment_code, amount } = req.body;
  
  if (!patient_id || !treatment_code || !amount) {
    return res.redirect("/claim?error=All fields are required.");
  }

  // Duplicate Check
  const isDuplicate = db.claims.some(c => c.patient_id === patient_id && c.treatment_code === treatment_code);
  if (isDuplicate) {
    return res.redirect("/claim?error=Duplicate Claim: A claim for this Patient ID and Treatment Code already exists.");
  }

  db.claims.push({ kind: "created", patient_id, treatment_code, amount: Number(amount) });
  res.send(`
    <html>
      <body style="font-family:sans-serif; text-align:center; padding:50px;">
        <h1 style="color:green;">&#9989; Claim Submitted Successfully</h1>
        <p>Patient ID: ${patient_id}</p>
        <p>Treatment Code: ${treatment_code}</p>
        <p>Amount: $${amount}</p>
        <a href="/claim">Submit Another Claim</a>
      </body>
    </html>
  `);
});

app.get("/__state", (_req, res) => {
  res.json(db);
});

app.post("/__reset", (req, res) => {
  db.claims = [];
  submitAttempts = 0;
  isLoggedIn = false;
  if (req.body?.chaos) {
    currentChaos = {
      flaky: Boolean(req.body.chaos.flaky),
    };
  } else {
    currentChaos = {
      flaky: process.env.CHAOS_FLAKY === "true",
    };
  }
  res.json({ status: "reset", count: 0, chaos: currentChaos });
});

const PORT = 3002;
app.listen(PORT, () => console.log(`[Healthcare Portal] Running on http://localhost:${PORT}`));

