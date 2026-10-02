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

console.log(chalk.gray('  Autonomous AI Operations Worker'));
console.log(chalk.gray('  Hand-written runtime — zero frameworks, zero magic\n'));

const goal = process.argv[2];

if (!goal) {
  console.log(chalk.yellow('Usage: npx tsx src/cli.ts "<goal>"'));
  console.log(chalk.gray('Example: npx tsx src/cli.ts "Process invoice apex_health.json into ERP portal"'));
  process.exit(1);
}

console.log(chalk.bold.white(`Goal: ${goal}\n`));
console.log(chalk.gray('Agent loop not yet implemented — coming in Target 6'));
