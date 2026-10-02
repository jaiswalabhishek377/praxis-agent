// CentrAgent — Interactive CLI Entry Point
// Usage: npx tsx src/cli.ts "Process invoice apex_health.json into ERP portal"

import chalk from 'chalk';

console.log(chalk.bold.cyan(`
 ██████╗███████╗███╗   ██╗████████╗██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
██║     █████╗  ██╔██╗ ██║   ██║   ██████╔╝███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   
██║     ██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   
╚██████╗███████╗██║ ╚████║   ██║   ██║  ██║██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   
 ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   
`));

import fs from 'fs';
import path from 'path';
import * as readline from 'readline/promises';
import { runAgentLoop } from './runtime/loop.js';

let goal = '';
let playbookContent = '';

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
    console.error(chalk.red.bold('\n❌ No playbook provided. Use --company <name> (e.g. --company apex) to inject company context.'));
    process.exit(1);
  }

  console.log(chalk.bold.white(`\nGoal: ${goal}\n`));

  try {
    const runResult = await runAgentLoop(goal, playbookContent);
    
    // Write out RunResult for the automated verifier to grab
    const runsDir = path.resolve(process.cwd(), 'runs');
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    
    const outPath = path.join(runsDir, `${runResult.runId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(runResult, null, 2));
    console.log(chalk.gray(`\nRun output saved to ${outPath}`));

    if (runResult.status !== 'success') {
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red.bold('\nFatal Error in Agent Loop:'));
    console.error(err);
    process.exit(1);
  }
}

main();
