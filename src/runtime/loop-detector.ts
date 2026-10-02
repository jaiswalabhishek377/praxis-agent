import crypto from 'crypto';

/**
 * LoopDetector ensures the agent does not get stuck in an infinite loop
 * repeating the same action on the exact same state.
 */
export class LoopDetector {
  private history: Map<string, number> = new Map();

  /**
   * Computes a SHA-256 hash of the environment state and the intended action.
   */
  private computeHash(stateStr: string, action: string, params: any): string {
    const payload = JSON.stringify({ stateStr, action, params });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Checks if the agent has repeated this exact state+action too many times.
   * Throws an error if a loop is detected, forcing a replan.
   */
  public check(stateStr: string, action: string, params: any): void {
    const hash = this.computeHash(stateStr, action, params);
    const count = (this.history.get(hash) || 0) + 1;
    this.history.set(hash, count);

    // If we've done this exact action in this exact state 3 times, we're stuck.
    if (count >= 3) {
      throw new Error(
        `[LOOP DETECTED]: You have attempted the action "${action}" with params ${JSON.stringify(
          params
        )} multiple times without the environment state changing. STOP doing this. You must try a completely different strategy, or use ask_user for help.`
      );
    }
  }

  /**
   * Clears the detection history (e.g. for a new task)
   */
  public reset(): void {
    this.history.clear();
  }
}
