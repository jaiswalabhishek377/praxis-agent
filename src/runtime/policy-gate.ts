import chalk from 'chalk';
import * as readline from 'readline/promises';

export type PolicyLevel = 'READ' | 'REVERSIBLE' | 'IRREVERSIBLE';

/**
 * Deterministic Code-Level Policy Gate
 * 
 * Intercepts LLM actions before execution to classify and enforce human-in-the-loop 
 * (HITL) approvals for destructive or high-value actions.
 * 
 * @param action - The literal action name emitted by the LLM
 * @param params - The parsed parameters for the action
 * @param domElements - The current snapshot of the DOM to evaluate context
 * @returns boolean indicating if the action is approved to proceed
 */
export async function evaluatePolicyGate(
  action: string,
  params: any,
  domElements: any[] = [],
  approverFn?: (action: string, label: string, values: Record<string, string>) => Promise<boolean>
): Promise<{ approved: boolean; reason?: string; kind?: 'human' | 'auto' | 'failsafe' }> {
  let level: PolicyLevel = 'READ';

  if (['browser_navigate', 'browser_type', 'browser_select'].includes(action)) {
    level = 'REVERSIBLE';
  } else if (action === 'browser_click') {
    level = 'IRREVERSIBLE';
  }

  // Auto-allow safe actions
  if (level !== 'IRREVERSIBLE') {
    return { approved: true, kind: 'auto' };
  }

  // For clicks, we check if it's a high-risk button
  const targetElement = domElements.find((e) => e.ref === params.ref);
  
  // FAIL SAFE: If we can't find the element in the current DOM, reject it.
  if (!targetElement) {
    console.log(chalk.red(`\n⚠️ POLICY GATE: Element ref [${params.ref}] not found in current snapshot. Failing safe.`));
    return { approved: false, reason: `Element ref [${params.ref}] not found in snapshot.`, kind: 'failsafe' };
  }

  const labelStr = targetElement.text || targetElement.label || targetElement.value || 'undefined';

  const riskyVerbs = ['submit', 'save', 'pay', 'send', 'delete', 'approve', 'confirm', 'create', 'transfer'];
  // Do not block simple link navigation, even if the link text says 'submit'
  const isSubmit = targetElement.tagName !== 'a' && riskyVerbs.some(verb => labelStr.toLowerCase().includes(verb));

  // If it's a submit action, trigger the human-in-the-loop gate
  if (isSubmit) {
    // Extract current form values from the snapshot
    const values: Record<string, string> = {};
    for (const el of domElements) {
      if ((el.tagName === 'input' || el.tagName === 'select' || el.tagName === 'textarea') && el.value) {
        const key = el.label || el.name || el.placeholder || `ref-${el.ref}`;
        values[key] = el.value;
      }
    }

    if (approverFn) {
      const isApproved = await approverFn(action, labelStr, values);
      return { 
        approved: isApproved, 
        reason: isApproved ? undefined : 'REJECTED by automated approver hook.',
        kind: 'human'
      };
    }

    if (process.env.AUTO_APPROVE === 'true') {
      console.log(chalk.bgYellow.black.bold(`\n ⚡ AUTO-APPROVED (audit-logged): click "${labelStr}" `));
      for (const [k, v] of Object.entries(values)) console.log(chalk.yellow(`   ${k}: ${v}`));
      return { approved: true, reason: 'auto-approve flag', kind: 'auto' };
    }

    console.log(chalk.bgRed.white.bold(`\n ⚠️ POLICY GATE: IRREVERSIBLE ACTION DETECTED `));
    console.log(chalk.red(` Agent is attempting to click: "${labelStr}"`));
    
    if (Object.keys(values).length > 0) {
      console.log(chalk.yellow(` Current form values:`));
      for (const [k, v] of Object.entries(values)) {
        console.log(chalk.yellow(`   ${k}: ${v}`));
      }
    }

    if (!process.stdin.isTTY) {
      console.log(chalk.red(` [Non-interactive terminal detected. Auto-denying action.]`));
      return { approved: false, reason: 'Non-interactive terminal auto-denied action.', kind: 'failsafe' };
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(chalk.yellow.bold(' Approve this action? [y/N]: '));
    rl.close();

    const approved = answer.trim().toLowerCase() === 'y';
    if (!approved) {
      console.log(chalk.white(' Action rejected by user.'));
      return { approved: false, reason: 'REJECTED by the human policy gate.', kind: 'human' };
    }
    console.log(chalk.green(' Action approved.'));
    return { approved: true, kind: 'human' };
  }

  return { approved: true, kind: 'auto' };
}
