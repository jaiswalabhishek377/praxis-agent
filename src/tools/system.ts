import readline from 'readline';
import chalk from 'chalk';

export interface FinishParams {
  status: 'success' | 'failed' | 'needs_help';
  summary: string;
  evidence?: string;
}

// ─── 1. ask_user ─────────────────────────────────────────────────
export async function ask_user(question: string): Promise<string> {
  // If automated answer is configured (used in CI or automated evaluation harness)
  if (process.env.AUTO_ANSWER) {
    console.log(chalk.cyan(`\n💬 [Agent Question]: ${question}`));
    console.log(chalk.gray(`   [Auto-Answer]: ${process.env.AUTO_ANSWER}`));
    return process.env.AUTO_ANSWER;
  }

  return new Promise((resolve) => {
    console.log('\n' + chalk.bgCyan.black(' 💬 HUMAN CLARIFICATION NEEDED ') + '\n');
    console.log(chalk.bold.white(question));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.yellow('\nYour response > '), (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || 'No response provided');
    });
  });
}

// ─── 2. finish ───────────────────────────────────────────────────
export async function finish(params: FinishParams): Promise<string> {
  const icon = params.status === 'success' ? '✅' : params.status === 'failed' ? '❌' : '⚠️';
  const statusLabel = params.status.toUpperCase();

  const lines = [
    `${icon} TASK FINISHED [Status: ${statusLabel}]`,
    `Summary: ${params.summary}`,
  ];

  if (params.evidence) {
    lines.push(`Evidence: ${params.evidence}`);
  }

  return lines.join('\n');
}
