# PraxisAgent — Autonomous AI Operations Worker

An autonomous operations worker designed to execute end-to-end IT, ERP, and healthcare workflows across multi-system environments with element-referenced browser automation, deterministic safety gates, fault-tolerant chaos recovery, and independent state verification.

---

## 🌟 Architecture & Core Principles

1. **Ephemeral DOM Snapshotting**:
   Rather than passing full HTML trees or maintaining bloated context, the agent operates via a compact numbered-element view (`[ref]` IDs, ~150–300 tokens per turn). Old DOM snapshots are pruned each turn while preserving the sequential text transcript, preventing context degradation.

2. **State-Action Hash Loop Detection**:
   Tracks execution state by computing a SHA-256 hash of `(page_state, action, params)`. If the agent repeats the exact same action in the exact same state 3 times without environmental progress, it aborts to prevent token waste and prompts replanning.

3. **Deterministic Human-in-the-Loop (HITL) Policy Gate**:
   A code-level safety firewall that intercepts risky action verbs (`submit`, `pay`, `approve`, `confirm`, `delete`). It displays the extracted form values, requests explicit human approval (`[y/N]`), and defaults to deny in non-interactive terminals. If denied, the agent halts safely with zero unauthorized database mutations.

4. **Multi-Model Provider Cascade & Circuit Breakers**:
   A 4-tier failover sequence across Gemini models (`gemini-3.5-flash-lite` → `gemini-flash-lite-latest` → `gemini-3-flash-preview` → `gemini-3.6-flash`), with optional Groq SDK fallback (`llama-3.3-70b-versatile`). Automatically catches HTTP 429 rate limits, context overflows, or provider outages with exponential backoff.

5. **Credential Isolation via `system_login`**:
   The agent is never given raw passwords in its prompt context. Instead, it issues `system_login({ system: "erp" | "healthcare" })`, and the runtime directly injects validated environment secrets into browser session storage.

6. **Independent State & Database Verifier**:
   An out-of-band verification layer unreachable by the agent's browser queries the target portal's database (`:3001/__state`, `:3002/__state`). It objectively verifies record creation, amount matching, and duplicate prevention against source documents, generating audit dossiers (`audit_dossier.json`) with screenshot proof.

---

## 🚀 Setup & Execution Guide

### 1. Prerequisites & Installation
* **Node.js**: v18+ or v20+ recommended.
* Clone the repository and install dependencies:
```bash
git clone https://github.com/jaiswalabhishek377/praxis-agent.git
cd praxis-agent
npm install
```

### 2. Environment Configuration
Create a `.env` file in the project root:
```env
GEMINI_API_KEY="your-gemini-api-key"
ERP_URL="http://localhost:3001"
CLAIMS_URL="http://localhost:3002"
```

### 3. Start Simulated Enterprise Portals
Launch the mock ERP (`:3001`) and Healthcare (`:3002`) portals in a separate terminal:
```bash
npm run dev:apps
```
*(Keep this terminal open while running the agent).*

---

## 🤖 Running the Autonomous Agent (CLI)

To launch the interactive CLI with company context:
```bash
npx tsx src/cli.ts --company globalcorp
```

When prompted:
```
🤖 What would you like me to do? 
>
```

### Example Prompts to Try:

1. **Unstructured Invoice Resolution (PDF Parsing & ERP Entry)**:
   ```
   Find the latest invoice from Company Acme Corp, extract the amount and due date, enter it into our internal system, and tell me once it is done.
   ```
   *The agent will inspect incoming files, compare internal dates, skip paid invoices, parse the unstructured PDF (`scan_0003.pdf`), log in to ERP, trigger the human approval gate, and submit.*

2. **Multi-System Healthcare Claim Routing**:
   ```
   Check my tickets for Dr. Evans's email and handle the claim request
   ```
   *The agent will read `tickets/ticket_02.txt`, deduce that this is a clinical claim, locate patient `P-9821`, route to the Healthcare portal (`:3002`), and file the outpatient claim.*

3. **Autonomous Ticket Handling**:
   ```
   Take care of the request in tickets/ticket_01.txt
   ```

---

## 📊 Evaluation & Benchmark Results

PraxisAgent was benchmarked across **9 end-to-end evaluation scenarios** covering core operations, cross-system routing, injected chaos (validation errors, session dropouts, flaky DOM submit buttons), and approval-denial safety gates.

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

### Running the Evaluation Suite
```bash
# Run all 9 scenarios
npx tsx src/eval/harness.ts

# Run an individual scenario
npx tsx src/eval/harness.ts --only SC-02

# Resume evaluation (skips already verified runs)
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

## 📁 Audit Dossiers & Artifacts
When executing tasks, PraxisAgent preserves complete local audit trails:
* **Trace Logs**: `runs/<run-id>.jsonl`
* **Run Metrics**: `runs/<run-id>.json`
* **Visual Screenshots**: `artifacts/<run-id>/step-X_after-click.png`
* **Verification Dossier**: `artifacts/<run-id>/audit_dossier.json`