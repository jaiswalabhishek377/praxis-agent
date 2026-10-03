// CentrAgent — Interactive CLI Entry Point
// Usage: npx tsx src/cli.ts "Process invoice src/test-data/invoices/INV-0472.json into ERP portal" --company globalcorp

import chalk from 'chalk';

console.log(chalk.bold.cyan(`
 ██████╗███████╗███╗   ██╗████████╗██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
██║     █████╗  ██╔██╗ ██║   ██║   ██████╔╝███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   
██║     ██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   
╚██████╗███████╗██║ ╚████║   ██║   ██║  ██║██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   
 ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   
`));
console.log(chalk.bold('Autonomous AI Operations Worker\n'));

import fs from 'fs';
import path from 'path';
import * as readline from 'readline/promises';
import { runAgentLoop } from './runtime/loop.js';
import { verifyRun, deriveExpectation } from './runtime/verifier.js';

let goal = '';
let playbookContent = '';
let expectArg: string | undefined;
let expectParsed: any;

// Parse args
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--company' && args[i + 1]) {
    const companyName = args[i + 1];
    if (!/^[a-z0-9_-]+$/i.test(companyName)) {
      console.error(chalk.red.bold(`\n❌ Invalid company name. Use only alphanumeric characters, dashes, and underscores.`));
      process.exit(1);
    }
    process.env.COMPANY_NAME = companyName; // Used by system_login
    const playbookPath = path.resolve(`companies/${companyName}.md`);
    if (fs.existsSync(playbookPath)) {
      playbookContent = fs.readFileSync(playbookPath, 'utf8');
      console.log(chalk.blue(`📚 Loaded playbook for: ${companyName}`));
    } else {
      console.log(chalk.yellow(`⚠️ Warning: Playbook not found at ${playbookPath}`));
    }
    i++; // skip next arg
  } else if (args[i] === '--expect' && args[i + 1]) {
    expectArg = args[i + 1];
    try {
      expectParsed = JSON.parse(expectArg);
    } catch (e) {
      console.error(chalk.red(`\n❌ Invalid JSON passed to --expect: ${(e as Error).message}`));
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--auto-approve') {
    process.env.AUTO_APPROVE = 'true';
  } else if (!args[i].startsWith('--')) {
    goal = args[i];
  }
}

async function main() {
  if (!goal) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    goal = await rl.question(chalk.green.bold('\n🤖 What would you like me to do? \n> '));
    rl.close();

    if (!goal.trim()) {
      console.log(chalk.red('Task cannot be empty. Exiting.'));
      process.exit(1);
    }
  }

  if (!playbookContent) {
    const defaultPlaybook = path.resolve('companies/globalcorp.md');
    if (fs.existsSync(defaultPlaybook)) {
      process.env.COMPANY_NAME = 'globalcorp';
      playbookContent = fs.readFileSync(defaultPlaybook, 'utf8');
      console.log(chalk.blue('📚 Loaded default playbook for: globalcorp'));
    } else {
      console.error(chalk.red.bold('\n❌ No playbook provided. Use --company <name> (e.g. --company globalcorp) to inject company context.'));
      process.exit(1);
    }
  }

  console.log(chalk.bold.white(`\nGoal: ${goal}\n`));

  try {
    let beforeState: any = {};
    try {
      const res1 = await fetch('http://localhost:3001/__state', { signal: AbortSignal.timeout(3000) }).catch(()=>null);
      if (res1?.ok) beforeState.erp = (await res1.json()).vouchers ?? [];
      
      const res2 = await fetch('http://localhost:3002/__state', { signal: AbortSignal.timeout(3000) }).catch(()=>null);
      if (res2?.ok) beforeState.healthcare = (await res2.json()).claims ?? [];
    } catch (e) {}

    const runResult = await runAgentLoop(goal, playbookContent);
    
    // Write out RunResult for the automated verifier to grab
    const runsDir = path.resolve(process.cwd(), 'runs');
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    
    const outPath = path.join(runsDir, `${runResult.runId}.json`);
    const fullData = { ...runResult, beforeState };
    fs.writeFileSync(outPath, JSON.stringify(fullData, null, 2));
    console.log(chalk.white(`\nRun output saved to ${outPath}`));

    let verdict: 'verified' | 'failed' | 'inconclusive' | 'unverified' = 'unverified';
    if (expectArg) {
      verdict = await verifyRun(runResult.runId, { expected: expectParsed });
    } else {
      const derived = deriveExpectation(runResult.runId);
      if (derived) {
        console.log(chalk.white('ℹ No --expect supplied: derived expected values from the source invoice on disk.'));
        verdict = await verifyRun(runResult.runId, { expected: derived.expected, warnings: derived.warnings });
      } else {
        console.log(chalk.yellow('⚠ UNVERIFIED: no --expect and no source invoice found; agent claim not checked.'));
      }
    }

    process.exit(verdict === 'verified' || (verdict === 'unverified' && runResult.status === 'success') ? 0 : 1);
  } catch (err) {
    console.error(chalk.red.bold('\nFatal Error in Agent Loop:'));
    console.error(err);
    process.exit(1);
  }
}

main();
