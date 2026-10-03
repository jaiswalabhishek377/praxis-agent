# PraxisAgent (CentrAgent) — Autonomous AI Operations Worker

An enterprise-grade, autonomous ReAct agent designed to execute end-to-end IT, ERP, and healthcare operations workflows across multi-system environments with deterministic safety gates, fault-tolerant chaos recovery, and independent state verification.

---

## 🌟 Key Architectural Pillars

1. **$O(1)$ Context Memory & DOM Isolation**:
   Maintains a compact turn transcript without history bloat. Interactive DOM elements are referenced via dynamic numeric `[ref]` IDs (~150–300 tokens) updated on each turn, preventing context degradation.

2. **Deterministic Multi-Tier Loop Detection**:
   Tracks cyclic action-state combinations across a 6-turn sliding window. Automatically intervenes with corrective guidance before wasteful token consumption occurs.

3. **Code-Level Human-in-the-Loop (HITL) Policy Gate**:
   Deterministic policy firewall that intercepts high-risk or irreversible mutations (e.g. `submit`, `pay`, `approve`, `confirm`). Enforces human or automated approver sign-off and cleanly halts with audit proof if denied.

4. **Multi-Model Provider Cascade & Circuit Breakers**:
   Dynamic failover architecture across model tiers (`gemini-3.5-flash-lite` → `gemini-flash-lite-latest` → `gemini-3-flash-preview` → `gemini-3.6-flash` / Groq). Catches HTTP 429 rate limits, context overflows, or provider outages with exponential backoff and transparent recovery.

5. **Zero-Knowledge System Login**:
   Eliminates credential leakage into LLM context prompts. The agent issues `system_login({ system: "erp" | "healthcare" })` and the runtime injects validated environment secrets directly into browser session storage.

6. **Independent State & DB Verifier**:
   Post-execution verification layer that inspects underlying databases and state endpoints independently of the LLM's self-reported summary, catching false claims, duplicate submissions, or data formatting mismatches.

---

## 📊 Evaluation & Benchmark Results

PraxisAgent was evaluated across **9 end-to-end benchmark scenarios** spanning single-system ERP voucher entries, cross-system healthcare claims, multi-document ambiguity resolution, chaos injections (portal validation errors, session dropouts, flaky DOM submit buttons), and approval-denial safety gates.

### 1. Standard Benchmark Suite (Optimal API Conditions)
*Verified: 9/9 (100% pass rate, 0 false claims)*

| ID | Scenario | Category | Runs | Verified | Steps | Tokens | Fallbacks | Time |
|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **SC-01** | Single JSON invoice entry (ERP) | Core | 1 | 1/1 | 8 | 13,618 | 0 | **18s** |
| **SC-02** | Unreliable filenames, paid invoice skipped | Core / Autonomy | 1 | 1/1 | 14 | 42,903 | 3 | **35s** |
| **SC-03** | PDF invoice parsing | Core | 1 | 1/1 | 8 | 14,918 | 0 | **16s** |
| **SC-04** | Incomplete invoice flagged, valid one submitted | Core / Autonomy | 1 | 1/1 | 13 | 37,105 | 2 | **35s** |
| **SC-05** | Healthcare claim submission | Multi-System | 1 | 1/1 | 12 | 26,824 | 2 | **26s** |
| **SC-06** | Chaos: validation error recovery | Chaos | 1 | 1/1 | 13 | 34,015 | 0 | **20s** |
| **SC-07** | Chaos: session timeout recovery | Chaos | 1 | 1/1 | 8 | 13,634 | 0 | **17s** |
| **SC-08** | Chaos: flaky submit retry | Chaos | 1 | 1/1 | 9 | 16,325 | 1 | **19s** |
| **SC-09** | Policy Gate: approval denied safety | Safety | 1 | 1/1 | 8 | 14,390 | 2 | **23s** |

---

### 2. High-Load Stress Test (Multi-Model Cascade & 429 Resilience)
*Tested under continuous, un-paused back-to-back scenario execution to evaluate real-time API rate limit failover.*

| ID | Scenario | Runs | Verified | Steps | Tokens | API Fallback Events | Time | Primary Resiliency Fallback |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **SC-01** | Single JSON invoice entry | 1 | 1/1 | 8 | 14,838 | 0 | **14s** | `gemini-3.5-flash-lite` |
| **SC-02** | Unreliable filenames & paid filter | 1 | 1/1 | 14 | 39,815 | 8 | **61s** | `gemini-3.6-flash` |
| **SC-03** | PDF invoice parsing | 1 | 1/1 | 8 | 16,405 | 0 | **14s** | `gemini-3.5-flash-lite` |
| **SC-04** | Incomplete invoice flagged | 1 | 1/1 | 13 | 38,750 | 12 | **42s** | `gemini-3-flash-preview` |
| **SC-05** | Healthcare claim submission | 1 | 1/1 | 11 | 26,057 | 9 | **43s** | `gemini-flash-lite-latest` |
| **SC-06** | Chaos: validation error | 1 | 1/1 | 8 | 15,454 | 3 | **26s** | `gemini-flash-lite-latest` |
| **SC-07** | Chaos: session timeout | 1 | 1/1 | 8 | 15,054 | 10 | **47s** | `gemini-3-flash-preview` |
| **SC-08** | Chaos: flaky submit | 1 | 1/1 | 9 | 17,036 | 0 | **17s** | `gemini-3.5-flash-lite` |
| **SC-09** | Policy Gate: approval denied safety | 1 | 1/1 | 8 | 15,099 | 7 | **36s** | `gemini-3.6-flash` |

> **Key Takeaway**: Despite aggressive HTTP 429 rate limiting during continuous execution, the Multi-Model Cascade achieved a **100% completion rate with 0 unhandled crashes and 0 corrupted database entries**.

---

## 🛠️ Getting Started

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY="your-gemini-api-key"
ERP_URL="http://localhost:3001"
CLAIMS_URL="http://localhost:3002"
```

### 3. Start Mock Enterprise Portals
In a separate terminal, launch the mock ERP and Healthcare portals:
```bash
npm run dev:apps
```
* **ERP Portal**: `http://localhost:3001`
* **Healthcare Portal**: `http://localhost:3002`

---

## 🧪 Running Evaluations

### Run Full Benchmark Suite
```bash
npx tsx src/eval/harness.ts
```

### Run a Single Scenario (Development Mode)
```bash
npx tsx src/eval/harness.ts --only SC-02
```

### Resume Evaluation (Skip Settled Runs)
```bash
npx tsx src/eval/harness.ts --resume
```

---

## 📂 Scenario Reference Guide

* **SC-01**: Baseline single JSON invoice voucher submission into ERP.
* **SC-02**: Reading request ticket, resolving unreliable file metadata, skipping already-paid invoices, and submitting latest bill.
* **SC-03**: Extracting unstructured invoice details from scanned PDF document (`scan_0003.pdf`) and submitting.
* **SC-04**: Multi-file candidate scanning, skipping incomplete invoice missing amount (`export_b.json`), submitting latest valid invoice (`scan_0003.pdf`), and flagging skipped file in summary.
* **SC-05**: Reading doctor request ticket, locating medical claim document, routing to Healthcare portal, and submitting outpatient claim.
* **SC-06**: Dynamic chaos recovery from portal form validation errors.
* **SC-07**: Dynamic chaos recovery from server session timeouts with automated re-authentication.
* **SC-08**: Dynamic chaos recovery from flaky submission buttons with state confirmation.
* **SC-09**: Deterministic human-in-the-loop approval denial verification (verifies zero records are created when human rejects submission).

---

## 📁 Artifacts & Audit Dossiers
For every execution run, complete audit trails are preserved:
* Run metrics and step traces: `runs/<run-id>.json`
* Step-by-step logs: `runs/<run-id>.jsonl`
* Visual proof screenshots: `artifacts/<run-id>/step-X_after-click.png`
* Verifier audit dossier: `artifacts/<run-id>/audit_dossier.json`