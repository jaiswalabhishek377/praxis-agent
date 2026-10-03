import chalk from 'chalk';
import ora from 'ora';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { callModel, RunTracker } from './adapter.js';
import { LoopDetector } from './loop-detector.js';
import { evaluatePolicyGate } from './policy-gate.js';

import {
  browser_navigate,
  browser_snapshot,
  browser_click,
  browser_type,
  browser_select,
  browser_get_text,
  browser_screenshot,
  system_login,
  closeBrowser,
  DOMSnapshot,
} from '../tools/browser.js';
import { list_files, read_file } from '../tools/files.js';
import { ask_user, finish } from '../tools/system.js';

export interface RunResult {
  runId: string;
  status: 'success' | 'failed' | 'needs_help' | 'aborted' | 'max_steps';
  steps: number;
  summary?: string;
  evidence?: string;
  verified?: boolean;        // filled by verifier.ts
  verifierReasons?: string[];
  metrics: ReturnType<RunTracker['getSummary']>;
  asks: number;              // clarification/approval count
  trace?: string[];          // The history array trace
  tracePath?: string;
}

const MAX_STEPS = parseInt(process.env.MAX_STEPS || '30', 10);

export async function runAgentLoop(
  goal: string,
  playbookContent: string = '',
  approverFn?: (action: string, label: string, values: Record<string, string>) => Promise<boolean>
): Promise<RunResult> {
  console.log(chalk.bold.cyan(`\n🚀 Initializing CentrAgent for goal:`));
  console.log(chalk.white(`"${goal}"\n`));

  const SYSTEM_PROMPT = `You are CentrAgent, an autonomous AI operations worker.
Your goal is to accomplish the user's task using the provided tools.
You operate in a ReAct loop: Understand -> Plan -> Act -> Observe.

${playbookContent ? `COMPANY KNOWLEDGE BASE (PLAYBOOK):\n${playbookContent}\n` : ''}
RULES:
1. You must figure out the steps yourself. Do not ask for help unless you are truly stuck or need human disambiguation.
2. The environment may have chaos (flaky buttons, validation errors, session timeouts). If an action fails, READ the error message, adapt your plan, and try again.
3. If the user specifies a specific file path (e.g. "Process invoice src/test-data/invoices/export_a.json"), simply read and process that file directly. Only if asked to find the "latest", "newest", or "unpaid" file from a folder or ticket without an exact file path, open and read EVERY candidate file in the folder (.json, .pdf, .txt), compare the dates inside each file, ignore invoices that are already paid, and if an incomplete invoice (e.g. missing amount) is encountered, process the valid invoice and mention the skipped incomplete filename in your final summary.
3b. If the portal rejects your submission (e.g. duplicate), do NOT switch to a different invoice just to get something submitted. Re-check whether you picked the correct invoice; if the chosen one is truly a duplicate, call finish with status "failed" or use ask_user.
4. For web apps, you interact via numeric "ref" IDs from the DOM snapshot, NOT CSS selectors.
5. Report what you observed. An independent verifier will check your result.
6. When the goal is fully achieved, call the 'finish' action with a summary and evidence.
7. Think step-by-step in the 'thought' field before choosing an 'action'.
8. Use system_login for authentication.
9. Refs change after every action, so use only the CURRENT PAGE section for the current state.
10. If an irreversible action (such as clicking Submit) is denied or rejected by the human approver / policy gate, the action was NOT executed. Do NOT retry submitting. Conclude the task immediately by calling 'finish' with status 'failed' and an explanation that the human approver denied the submission.
11. When entering values into numeric input fields (like amount), enter the clean numeric value without currency symbols or thousands commas (e.g. 1450 or 1450.00 instead of $1,450.00).
`;

  const tracker = new RunTracker();
  const loopDetector = new LoopDetector();

  // History holds the transcript of turns (TEXT ONLY, NO SNAPSHOTS)
  const history: string[] = [
    `[USER GOAL]: ${goal}`
  ];

  const runId = crypto.randomUUID();
  
  const runsDir = path.join(process.cwd(), 'runs');
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  const tracePath = path.join(runsDir, `${runId}.jsonl`);
  const trace = (entry: object) => {
    try {
      fs.appendFileSync(tracePath, JSON.stringify(entry) + '\n');
    } catch {}
  };

  let currentDom: DOMSnapshot | null = null;
  let isFinished = false;
  let step = 1;
  let asks = 0;
  let consecutiveFailures = 0;
  let finalStatus: RunResult['status'] = 'max_steps';
  let finalSummary = '';
  let finalEvidence = '';

  try {
    while (step <= MAX_STEPS && !isFinished) {
      console.log(chalk.white(`\n--- Step ${step} ---`));
      const spinner = ora({ text: 'Thinking...', color: 'cyan' }).start();

      const userPrompt = history.join('\n\n') + 
        (currentDom ? `\n\n[CURRENT PAGE — refs valid ONLY for this snapshot]\n${currentDom.formatted}` : '');

      let result;
      try {
        result = await callModel({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          tracker
        });
        consecutiveFailures = 0; // Reset on successful model call
      } catch (modelErr: any) {
        spinner.fail(chalk.red(`Model Error: ${modelErr.message}`));
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          console.log(chalk.red.bold(`\n❌ Aborting: 3 consecutive model failures.`));
          finalStatus = 'aborted';
          break;
        }
        history.push(`[SYSTEM ERROR during ${step}]: LLM call failed (${modelErr.message}). Retrying.`);
        step++;
        continue;
      }

      spinner.succeed(chalk.green(`Thought: ${result.data.thought}`));
      console.log(chalk.magenta(`Action: ${result.data.action}`));
      if (Object.keys(result.data.params).length > 0) {
        console.log(chalk.white(`Params: ${JSON.stringify(result.data.params)}`));
      }

      const { action, params } = result.data;
      const stateStr = currentDom?.formatted || history.slice(-3).join('\n');

      try {
        loopDetector.check(stateStr, action, params);
      } catch (loopErr: any) {
        console.log(chalk.red(`\n🔄 ${loopErr.message}`));
        history.push(`[SYSTEM ERROR]: ${loopErr.message}`);
        step++;
        continue;
      }

      const gateResult = await evaluatePolicyGate(action, params, currentDom?.elements || [], approverFn);
      if (gateResult.kind === 'human') {
        asks++;
      }
      
      if (!gateResult.approved) {
        const sysMessage = `[SYSTEM]: Action '${action}' was DENIED by the policy gate / approver (${gateResult.reason || 'Rejected'}). The action was NOT executed. Do NOT retry this action. Conclude the task immediately by calling 'finish' with status 'failed' explaining that approval was denied.`;
        history.push(sysMessage);
        
        // Trace rejected step
        trace({
          step,
          thought: result.data.thought,
          action,
          params,
          observation: `Policy Gate Denied: ${gateResult.reason}`,
          model: result.model,
          provider: result.provider,
          screenshot: "",
          error: null
        });
        
        step++;
        continue;
      }

      let actionResult = '';
      let appendSnapshot = false;
      let shotName = '';

      // Proof of what was about to be submitted (only around clicks, not every step)
      if (action === 'browser_click') {
        try { await browser_screenshot(`${runId}/step-${step}_before-click`); } catch { /* non-fatal */ }
      }

      spinner.start(chalk.cyan(`Executing ${action}...`));

      try {
        switch (action) {
          case 'browser_navigate':
            actionResult = await browser_navigate((params as any).url);
            appendSnapshot = true;
            break;
          case 'browser_snapshot':
            actionResult = `Snapshot refreshed (see CURRENT PAGE).`;
            appendSnapshot = true;
            break;
          case 'browser_click':
            actionResult = await browser_click((params as any).ref);
            appendSnapshot = true;
            break;
          case 'browser_type':
            actionResult = await browser_type((params as any).ref, (params as any).text);
            appendSnapshot = true;
            break;
          case 'browser_select':
            actionResult = await browser_select((params as any).ref, (params as any).value);
            appendSnapshot = true;
            break;
          case 'browser_get_text':
            actionResult = await browser_get_text((params as any).ref);
            break;
          case 'system_login':
            actionResult = await system_login((params as any).system);
            appendSnapshot = true;
            break;
          case 'list_files':
            actionResult = await list_files((params as any).dir);
            break;
          case 'read_file':
            actionResult = await read_file((params as any).path);
            break;
          case 'ask_user':
            spinner.stop();
            asks++;
            actionResult = await ask_user((params as any).question);
            spinner.start('Resuming...');
            break;
          case 'finish':
            spinner.stop();
            const finishParams = params as any;
            actionResult = await finish(finishParams);
            finalStatus = finishParams.status || 'success';
            finalSummary = finishParams.summary || '';
            finalEvidence = finishParams.evidence || '';
            isFinished = true;
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        spinner.succeed(chalk.blue(`Result:`));
        
        // Auto-fetch current DOM for NEXT turn's prompt, but do NOT push it to history array
        if (appendSnapshot) {
          try {
            currentDom = await browser_snapshot();
          } catch (snapErr: any) {
            console.log(chalk.yellow(`[Warning: Failed to capture auto-snapshot: ${snapErr.message}]`));
            currentDom = null;
          }
          if (action === 'browser_click') {
            try {
              await browser_screenshot(`${runId}/step-${step}_after-click`);
              shotName = `${runId}/step-${step}_after-click.png`;
            } catch (picErr: any) {
              console.log(chalk.yellow(`[Warning: Failed to capture screenshot: ${picErr.message}]`));
            }
          }
        }

        console.log(chalk.white(actionResult.length > 500 ? actionResult.substring(0, 500) + '... [truncated]' : actionResult));

        // Record purely text-based history
        history.push(
          `[Agent Turn ${step}]\nThought: ${result.data.thought}\nAction: ${action}\nParams: ${JSON.stringify(params)}\n\n[Observation]\n${actionResult}`
        );

        // Trace successful step
        trace({
          step,
          thought: result.data.thought,
          action,
          params,
          observation: actionResult.substring(0, 500) + (actionResult.length > 500 ? '...' : ''),
          model: result.model,
          provider: result.provider,
          screenshot: shotName,
          error: null
        });

      } catch (err: any) {
        spinner.fail(chalk.red(`Tool Error: ${err.message}`));
        history.push(`[SYSTEM ERROR during ${step}]: Action ${action} failed: ${err.message}. Adjust your plan and try again.`);
        
        // Trace error step
        trace({
          step,
          thought: result?.data?.thought || '',
          action: action || 'unknown',
          params: params || {},
          observation: 'Error',
          model: result?.model || 'unknown',
          provider: result?.provider || 'unknown',
          screenshot: '',
          error: err.message
        });

        try {
          currentDom = await browser_snapshot(); // Re-snapshot after failure to prevent stale refs
        } catch (e) {
          // ignore
        }
      }

      step++;
    }

    if (!isFinished && finalStatus === 'max_steps') {
      console.log(chalk.red.bold(`\n❌ Agent reached MAX_STEPS (${MAX_STEPS}) without calling finish(). Task aborted.`));
    }

  } catch (fatalErr: any) {
    console.error(chalk.red.bold(`\n❌ Fatal Error in Loop: ${fatalErr.message}`));
    finalStatus = 'aborted';
    finalSummary = String(fatalErr);
  } finally {
    console.log(chalk.cyan(`\nCleaning up...`));
    try {
      await closeBrowser();
    } catch (e) {}
  }
  
  // Safe return OUTSIDE finally
  const summary = tracker.getSummary();
  console.log(chalk.bold.white(`\n=== Run Summary ===`));
  console.log(`Status:        ${finalStatus.toUpperCase()}`);
  
  // INTERVIEW TALKING POINT: 
  // If they ask "How do you handle multiple LLM providers?", explain the Adapter pattern here.
  // You can easily swap process.env.GEMINI_MODEL for process.env.GROQ_MODEL, or better yet,
  // read `adapter.defaultModel` if you build a GroqAdapter that implements the same interface.
  const activeModel = process.env.GROQ_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  
  // Format the detailed model usage (e.g. "gemini-3.5-flash-lite: 10x, groq-llama3: 1x")
  const usageDetail = Object.entries(summary.modelUsage)
    .map(([model, count]) => `${model}: ${count}x`)
    .join(', ');

  console.log(`Model(s):      ${usageDetail || activeModel}`);
  console.log(`Total Steps:   ${step > 1 ? step - 1 : 0}`);
  console.log(`Total Tokens:  ${summary.totalTokens} (Prompt: ${summary.promptTokens}, Completion: ${summary.completionTokens})`);
  if (summary.fallbackEvents > 0) {
    console.log(`Fallbacks:     ${summary.fallbackEvents} (Agent recovered from API errors)`);
  }
  
  return {
    runId,
    status: finalStatus,
    steps: step > 1 ? step - 1 : 0,
    summary: finalSummary,
    evidence: finalEvidence,
    metrics: summary,
    asks: asks,
    trace: history,
    tracePath: path.join(process.cwd(), 'runs', `${runId}.jsonl`)
  };
}
