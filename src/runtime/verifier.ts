import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

export interface Expectation {
  kind: 'created' | 'not_created';
  vendor: string; 
  invoiceNumber: string; 
  amount: number; 
  dueDate?: string; // ISO
}

export interface VerifierConfig {
  expected: Expectation;
  erpUrl?: string;
  beforeState?: any[]; // Passed in by harness
}

const isoDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return `${m[3]}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return null;
};

export function checkVouchers(exp: Expectation, before: any[] | undefined, after: any[]): string[] {
  const reasons: string[] = [];
  const mine = after.filter(v => v.invoice_number === exp.invoiceNumber);
  
  if (exp.kind === 'not_created') {
    if (before !== undefined) {
      const delta = after.length - before.length;
      if (delta !== 0) reasons.push(`Expected no new vouchers, found ${delta}.`);
    } else {
      if (mine.length > 0) reasons.push(`Found voucher ${exp.invoiceNumber} but expected not_created.`);
    }
    return reasons;
  }

  if (mine.length === 0) reasons.push(`No voucher for ${exp.invoiceNumber}.`);
  if (mine.length > 1) reasons.push(`Duplicate vouchers: ${mine.length}.`);
  
  if (before !== undefined) {
    const delta = after.length - before.length;
    if (delta !== 1) reasons.push(`Expected exactly 1 new voucher, found ${delta}.`);
  }

  const v = mine[0];
  if (v) {
    if (!String(v.vendor_name).toLowerCase().includes(exp.vendor.toLowerCase()))
      reasons.push(`Vendor mismatch: "${v.vendor_name}".`);
      
    const dbAmt = typeof v.amount_usd === 'string' ? parseFloat(v.amount_usd.replace(/[^\d.-]/g, '')) : v.amount_usd;
    if (Math.round(dbAmt * 100) !== Math.round(exp.amount * 100))
      reasons.push(`Amount mismatch: ERP ${v.amount_usd}, expected ${exp.amount}.`);
      
    if (exp.dueDate && isoDate(v.due_date) !== exp.dueDate)
      reasons.push(`Due date mismatch: ERP ${v.due_date}, expected ${exp.dueDate}.`);
  }
  return reasons;
}

export async function verifyRun(runId: string, config: VerifierConfig): Promise<'verified' | 'failed' | 'inconclusive'> {
  const runPath = path.resolve(`runs/${runId}.json`);
  if (!fs.existsSync(runPath)) {
    console.error(chalk.red(`Run file not found: ${runPath}`));
    return 'inconclusive';
  }

  const runData = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  console.log(chalk.bold.blue(`\n🔍 Verifying Run: ${runId}`));
  console.log(chalk.gray(`Agent claimed status: ${runData.status}`));

  const erpUrl = config.erpUrl || 'http://localhost:3001';
  let afterVouchers: any[] = [];
  
  try {
    const res = await fetch(`${erpUrl}/__state`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    afterVouchers = state.vouchers || [];
  } catch (err: any) {
    console.error(chalk.yellow(`Inconclusive: Failed to connect to mock ERP to verify state (${err.message})`));
    runData.verified = null;
    runData.verifierReasons = [`Inconclusive: Failed to connect to ERP`];
    fs.writeFileSync(runPath, JSON.stringify(runData, null, 2));
    return 'inconclusive';
  }

  const beforeVouchers = config.beforeState || runData.beforeState;
  const reasons = checkVouchers(config.expected, beforeVouchers, afterVouchers);

  // Cross-check claimed status with expectations
  if (runData.status !== 'success' && config.expected.kind !== 'not_created') {
    reasons.push(`Agent stopped with status: ${runData.status} but expectation was ${config.expected.kind}`);
  }
  if (runData.status === 'success' && config.expected.kind === 'not_created') {
    reasons.push(`Agent claimed success but the expectation was not_created (doing nothing)`);
  }

  if (reasons.length === 0) {
    console.log(chalk.green(`✅ VERIFIED: Database perfectly matches expectation for ${config.expected.invoiceNumber}`));
    runData.verified = true;
    runData.verifierReasons = ['Voucher successfully matched all expectations.'];
    if (beforeVouchers === undefined) {
      runData.verifierReasons.push('Verified without delta check (beforeState missing)');
    }
    fs.writeFileSync(runPath, JSON.stringify(runData, null, 2));
    return 'verified';
  } else {
    console.log(chalk.red(`❌ FAILED: Verifier caught mismatches.`));
    reasons.forEach(r => console.log(chalk.red(`   - ${r}`)));
    runData.verified = false;
    runData.verifierReasons = reasons;
    fs.writeFileSync(runPath, JSON.stringify(runData, null, 2));
    return 'failed';
  }
}

// CLI Execution (if run directly)
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runId = process.argv[2];
  if (!runId) {
    console.error(chalk.red('Usage: npx tsx src/runtime/verifier.ts <runId>'));
    process.exit(1);
  }
  
  verifyRun(runId, {
    expected: {
      kind: 'created',
      vendor: 'Apex',
      amount: 1450.00,
      invoiceNumber: 'AH-7891',
      dueDate: '2026-11-15'
    }
  }).then(status => {
    if (status === 'failed') process.exit(1);
  });
}
