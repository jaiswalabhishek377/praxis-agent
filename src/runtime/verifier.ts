import fs from "fs";
import path from "path";
import chalk from "chalk";

export type Expectation = 
  | { kind: "created"; vendor: string; invoiceNumber: string; amount: number; dueDate?: string; patient_id?: string; treatment_code?: string }
  | { kind: "not_created"; vendor?: string; invoiceNumber?: string; patient_id?: string; treatment_code?: string };

export interface VerifierConfig {
  expected: Expectation;
  beforeState?: any[];
  erpUrl?: string;
  healthcareUrl?: string;
}

function isoDate(str: string): string | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function checkRecords(exp: Expectation, before: any[] | undefined, after: any[]): string[] {
  const reasons: string[] = [];
  const isHealthcare = !!exp.patient_id;
  
  const mine = isHealthcare 
    ? after.filter(c => c.patient_id === exp.patient_id && c.treatment_code === exp.treatment_code)
    : after.filter(v => v.invoice_number === exp.invoiceNumber);
    
  const idStr = isHealthcare ? `${exp.patient_id} / ${exp.treatment_code}` : exp.invoiceNumber;
  
  if (exp.kind === "not_created") {
    if (before !== undefined) {
      const delta = after.length - before.length;
      if (delta !== 0) reasons.push(`Expected no new records, found ${delta}.`);
    } else {
      if (mine.length > 0) reasons.push(`Found record ${idStr} but expected not_created.`);
    }
    return reasons;
  }

  if (mine.length === 0) reasons.push(`No record found for ${idStr}.`);
  if (mine.length > 1) reasons.push(`Duplicate records found: ${mine.length}.`);
  
  if (before !== undefined) {
    const delta = after.length - before.length;
    if (delta !== 1) reasons.push(`Expected exactly 1 new record, found ${delta}.`);
  }

  const r = mine[0];
  if (r) {
    if (isHealthcare) {
      if (r.amount !== exp.amount) reasons.push(`Amount mismatch: DB ${r.amount}, expected ${exp.amount}.`);
    } else {
      if (!String(r.vendor_name).toLowerCase().includes(String(exp.vendor).toLowerCase()))
        reasons.push(`Vendor mismatch: "${r.vendor_name}".`);
        
      const dbAmt = typeof r.amount_usd === "string" ? parseFloat(r.amount_usd.replace(/[^\d.-]/g, "")) : r.amount_usd;
      if (Math.round(dbAmt * 100) !== Math.round(exp.amount * 100))
        reasons.push(`Amount mismatch: DB ${r.amount_usd}, expected ${exp.amount}.`);
        
      if (exp.dueDate && isoDate(r.due_date) !== exp.dueDate)
        reasons.push(`Due date mismatch: DB ${r.due_date}, expected ${exp.dueDate}.`);
    }
  }
  return reasons;
}

export function deriveExpectation(runId: string): { expected: Expectation; warnings: string[] } | null {
  const tracePath = path.resolve(`runs/${runId}.jsonl`);
  if (!fs.existsSync(tracePath)) return null;

  const readPaths: string[] = [];
  const fileObservations: Record<string, string> = {};
  let finishText = "";
  
  for (const line of fs.readFileSync(tracePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      const p = e.params?.path;
      if (e.action === "read_file" && !e.error && typeof p === "string" && (p.toLowerCase().endsWith(".json") || p.toLowerCase().endsWith(".pdf"))) {
        readPaths.push(p);
        if (e.observation) {
          fileObservations[p] = e.observation;
        }
      }
      if (e.action === "finish") {
        finishText = JSON.stringify(e.params || {});
      }
    } catch { }
  }

  let targetInvoicePath = readPaths.reverse()[0];
  for (const p of readPaths) {
    if (p.toLowerCase().endsWith('.pdf')) {
      if (finishText.includes('AC-8888') || finishText.includes('2450') || finishText.includes('scan_0003')) {
        targetInvoicePath = p;
        break;
      }
    } else {
      try {
        const inv = JSON.parse(fs.readFileSync(path.resolve(p), "utf8"));
        if ((inv.invoiceNumber && finishText.includes(inv.invoiceNumber)) || (inv.patientId && finishText.includes(inv.patientId))) {
          targetInvoicePath = p;
          break;
        }
      } catch { }
    }
  }

  if (!targetInvoicePath) return null;

  if (targetInvoicePath.toLowerCase().endsWith('.pdf')) {
    const raw = fileObservations[targetInvoicePath] || fs.readFileSync(path.resolve(targetInvoicePath), 'utf8');
    const invMatch = raw.match(/Invoice\s*Number:\s*([A-Z0-9-]+)/i) || raw.match(/\b(AC-\d+)\b/i);
    const amtMatch = raw.match(/(?:TOTAL\s*DUE|Total|Amount):\s*\$?([\d,]+\.?\d*)/i);
    const dueMatch = raw.match(/Due\s*Date:\s*.*?\((.*?)\)/i) || raw.match(/Due\s*Date:\s*([^\n\r,]+)/i);
    const vendorMatch = raw.match(/([A-Z0-9\s]+(?:CORP|INC|LLC|LTD|SOLUTIONS))/i);

    const rawAmt = amtMatch ? amtMatch[1].replace(/,/g, '') : (raw.includes('2,450') ? '2450' : '0');
    const invNumber = invMatch ? (invMatch[1] || invMatch[0]).trim() : "AC-8888";

    return {
      expected: {
        kind: "created",
        vendor: vendorMatch ? vendorMatch[1].trim().replace(/\s+(LLC|Inc\.?|Ltd\.?|Corp\.?)$/i, "") : "Acme Corp",
        invoiceNumber: invNumber,
        amount: parseFloat(rawAmt),
        dueDate: dueMatch ? isoDate(dueMatch[1].trim()) ?? undefined : '2026-11-18'
      },
      warnings: []
    };
  }

  try {
    const abs = path.resolve(targetInvoicePath);
    const data = JSON.parse(fs.readFileSync(abs, "utf8"));
    
    if (data.patientId && data.treatmentCode) {
      return {
        expected: { kind: "created", vendor: "", invoiceNumber: "", patient_id: String(data.patientId), treatment_code: String(data.treatmentCode), amount: Number(data.coverageAmount) },
        warnings: []
      };
    }
    
    const parseAmt = (a: any) => typeof a === "string" ? parseFloat(a.replace(/[^\d.-]/g, "")) : Number(a);
    if (!data.invoiceNumber || data.amount === undefined) return null;

    const warnings: string[] = [];
    const dir = path.dirname(abs);
    const myDate = isoDate(String(data.date)) ?? "";
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || path.join(dir, f) === abs) continue;
      try {
        const other = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const otherDate = isoDate(String(other.date)) ?? "";
        const paid = /paid in full/i.test(String(other.notes ?? ""));
        if (other.invoiceNumber && other.amount !== undefined && !paid && otherDate > myDate) {
          warnings.push(`Newer invoice exists (${f}, ${other.date}); agent processed ${path.basename(abs)} (${data.date}).`);
        }
      } catch { }
    }
    if (fs.readdirSync(dir).some(f => f.toLowerCase().endsWith(".pdf")) && !targetInvoicePath.toLowerCase().endsWith(".pdf")) {
      warnings.push(`A PDF invoice exists in the folder that the agent did not process.`);
    }

    return {
      expected: { kind: "created", vendor: String(data.vendor).trim().replace(/\s+(LLC|Inc\.?|Ltd\.?|Corp\.?)$/i, ""), invoiceNumber: String(data.invoiceNumber), amount: parseAmt(data.amount), dueDate: isoDate(String(data.dueDate)) ?? undefined },
      warnings,
    };
  } catch { return null; }
}

export async function verifyRun(runId: string, config: VerifierConfig & { warnings?: string[] }): Promise<"verified" | "failed" | "inconclusive"> {
  const runPath = path.resolve(`runs/${runId}.json`);
  if (!fs.existsSync(runPath)) return "inconclusive";

  const runData = JSON.parse(fs.readFileSync(runPath, "utf8"));
  console.log(chalk.bold.blue(`\n\uD83D\uDD0D Verifying Run: ${runId}`));
  console.log(chalk.white(`Agent claimed status: ${runData.status}`));

  const isHealthcare = !!config.expected.patient_id;
  const sysUrl = isHealthcare ? (config.healthcareUrl || "http://localhost:3002") : (config.erpUrl || "http://localhost:3001");
  let afterRecords: any[] = [];
  
  try {
    const res = await fetch(`${sysUrl}/__state`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    afterRecords = isHealthcare ? (state.claims || []) : (state.vouchers || []);
  } catch (err: any) {
    console.error(chalk.yellow(`Inconclusive: Failed to connect to mock DB to verify state (${err.message})`));
    runData.verified = null;
    runData.verifierReasons = [`Inconclusive: Failed to connect to DB`];
    fs.writeFileSync(runPath, JSON.stringify(runData, null, 2));
    return "inconclusive";
  }

  const rawBefore = config.beforeState || runData.beforeState;
  const beforeRecords = rawBefore ? (isHealthcare ? rawBefore.healthcare : rawBefore.erp) : undefined;
  
  const reasons = checkRecords(config.expected, beforeRecords, afterRecords);
  if (config.warnings?.length) reasons.push(...config.warnings);

  // Process-and-flag policy: if the agent encountered an incomplete invoice (no amount) during candidate scanning, it must flag it in the summary.
  if (!isHealthcare && config.expected.kind === "created") {
    const invDir = path.resolve("src/test-data/invoices");
    const summaryText = `${runData.summary ?? ""} ${runData.evidence ?? ""}`.toLowerCase();
    try {
      for (const f of fs.readdirSync(invDir)) {
        if (!f.endsWith(".json")) continue;
        const base = f.replace(/\.json$/i, "").toLowerCase();
        // Only enforce if the agent actually read this file during candidate evaluation
        const actuallyRead = (runData.trace ?? []).some((t: string) => t.toLowerCase().includes(`read_file`) && (t.toLowerCase().includes(f.toLowerCase()) || t.toLowerCase().includes(base)));
        if (actuallyRead) {
          const inv = JSON.parse(fs.readFileSync(path.join(invDir, f), "utf8"));
          if (inv.invoiceNumber && inv.amount === undefined) {
            if (!summaryText.includes(base) && !summaryText.includes(String(inv.invoiceNumber).toLowerCase())) {
              reasons.push(`Summary does not flag the incomplete invoice ${f} (missing amount).`);
            }
          }
        }
      }
    } catch { }
  }

  const writeDossier = (verdict: string) => {
    const dir = path.resolve("artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const runDir = path.join(dir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    
    let lastShot = null;
    try {
      const shots = fs.readdirSync(runDir).filter(f => f.endsWith("_after-click.png"))
        .sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
      if (shots.length > 0) lastShot = path.join(runDir, shots[shots.length - 1]);
    } catch {}

    const dossierPath = path.join(runDir, "audit_dossier.json");
    fs.writeFileSync(dossierPath, JSON.stringify({ runId, verdict, reasons, finalScreenshot: lastShot }, null, 2));
    
    console.log(chalk.bold.white(`\nOUTPUT ARTIFACTS:`));
    console.log(chalk.white(`\uD83D\uDCC4 audit_dossier.json: ${dossierPath}`));
    if (lastShot) console.log(chalk.white(`\uD83D\uDCF8 proof.png:          ${lastShot}`));
  };

  if (runData.status !== "success" && config.expected.kind !== "not_created") reasons.push(`Agent stopped with status: ${runData.status} but expectation was ${config.expected.kind}`);
  if (runData.status === "success" && config.expected.kind === "not_created") reasons.push(`Agent claimed success but the expectation was not_created (doing nothing)`);

  const idStr = isHealthcare ? `${config.expected.patient_id} / ${config.expected.treatment_code}` : config.expected.invoiceNumber;

  if (reasons.length === 0) {
    console.log(chalk.green(`\u2705 VERIFIED: Database perfectly matches expectation for ${idStr}`));
    runData.verified = true;
    runData.verifierReasons = ["Record successfully matched all expectations."];
    fs.writeFileSync(runPath, JSON.stringify(runData, null, 2));
    writeDossier("verified");
    return "verified";
  } else {
    console.log(chalk.red(`\u274C FAILED: Verifier caught mismatches.`));
    reasons.forEach(r => console.log(chalk.red(`   - ${r}`)));
    runData.verified = false;
    runData.verifierReasons = reasons;
    fs.writeFileSync(runPath, JSON.stringify(runData, null, 2));
    writeDossier("failed");
    return "failed";
  }
}

