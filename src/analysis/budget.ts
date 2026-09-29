/**
 * Spending reservations for calls that run at the same time (plan-analysis-speed, item 1).
 * Before a paid call starts, its ceiling is reserved in one synchronous step (no await between
 * the check and the reservation), so two calls can never both see the same balance. When the
 * call ends, the reservation is dropped and the real cost is counted by the caller's onCost.
 */

/** Highest cost seen per call plus a margin; other steps reserve everything that is left. */
export const STEP_CEILING_USD: Readonly<Record<string, number>> = {
  "full-analysis": 0.4,
  review: 0.4,
  adjudicate: 0.2,
  "layer-diff": 0.2,
};

export interface Reservation {
  /** The most this call may spend (the CLI's own budget guard). */
  maxUsd: number;
  /** Drops the reservation; `usd` is the call's real cost (to raise the ceiling if above). */
  done: (usd: number) => void;
}

export interface Ledger {
  /** What is left: the limit minus what was spent and what open calls may still spend. */
  remaining: () => number;
  /** Reserves one call's ceiling, or null when what is left cannot fund it. */
  reserve: (step: string) => Reservation | null;
  /** Dollars reserved by calls still running (shown while stopping). */
  open: () => number;
  warnings: string[];
}

export function ledger(
  limit: number,
  spent: () => number,
  start: Readonly<Record<string, number>> = STEP_CEILING_USD,
): Ledger {
  const open = new Map<number, number>();
  const ceilings: Record<string, number> = { ...start };
  const warnings: string[] = [];
  let next = 0;
  const openSum = () => [...open.values()].reduce((a, b) => a + b, 0);
  const remaining = () => limit - spent() - openSum();
  return {
    remaining,
    open: openSum,
    warnings,
    reserve(step) {
      const left = remaining();
      if (left <= 0.01) return null;
      const ceiling = ceilings[step];
      if (ceiling !== undefined && left < ceiling) return null;
      const amount = ceiling ?? left;
      const id = next++;
      open.set(id, amount);
      return {
        maxUsd: left,
        done(usd) {
          open.delete(id);
          if (ceiling !== undefined && usd > (ceilings[step] ?? 0)) {
            warnings.push(
              `A ${step} call cost $${usd.toFixed(2)}, above its reserved $${(ceilings[step] ?? 0).toFixed(2)}; later calls reserve more.`,
            );
            ceilings[step] = Math.round(usd * 1.1 * 100) / 100;
          }
        },
      };
    },
  };
}
