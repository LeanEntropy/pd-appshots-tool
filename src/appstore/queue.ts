/**
 * The polite request queue for Apple (plan-app-store 1.4): one request at a time, spaced by a
 * minimum interval (the Search API is documented at about 20 calls a minute; we use 15). A 429
 * or 503 answer waits for its retry-after (or a doubling backoff) and tries again, a few times.
 * Clock and sleep are injectable so tests never wait.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export type Fetcher = (url: string) => Promise<Response>;

export interface QueueOptions {
  minIntervalMs: number;
  /** First backoff when the answer has no retry-after; doubles on each retry. */
  backoffMs?: number;
  maxRetries?: number;
  /** Longest wait accepted from one retry-after; a longer one stops the request. */
  maxWaitMs?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${new URL(url).pathname}`);
  }
}

/** Seconds (or an HTTP date) from a retry-after header, in ms; null when absent or unreadable. */
export function retryAfterMs(v: string | null, now: number): number | null {
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export class AppleQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private last = Number.NEGATIVE_INFINITY;
  /** Requests sent, and 429/503 answers met (for the run summary and tests). */
  public sent = 0;
  public throttled = 0;
  public waitedMs = 0;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly opts: QueueOptions,
    private readonly clock: Clock = realClock,
  ) {}

  /** One GET through the queue, with the pacing and the backoff; resolves with the response. */
  get(url: string): Promise<Response> {
    const run = this.chain.then(() => this.send(url));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async json(url: string): Promise<unknown> {
    return (await this.get(url)).json();
  }

  async bytes(url: string): Promise<Buffer> {
    return Buffer.from(await (await this.get(url)).arrayBuffer());
  }

  private async pace(): Promise<void> {
    const ms = this.last + this.opts.minIntervalMs - this.clock.now();
    if (ms > 0) {
      this.waitedMs += ms;
      await this.clock.sleep(ms);
    }
  }

  private async send(url: string): Promise<Response> {
    const maxRetries = this.opts.maxRetries ?? 4;
    let backoff = this.opts.backoffMs ?? 15_000;
    for (let attempt = 0; ; attempt++) {
      await this.pace();
      this.sent++;
      let res: Response;
      try {
        res = await this.fetcher(url);
      } catch (e) {
        this.last = this.clock.now();
        if (attempt >= maxRetries) throw e;
        await this.wait(backoff);
        backoff *= 2;
        continue;
      }
      this.last = this.clock.now();
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        this.throttled++;
        const told = retryAfterMs(res.headers.get("retry-after"), this.clock.now());
        const ms = told ?? backoff;
        // A wait longer than we accept is never cut short (that would hammer Apple): stop.
        if (ms > (this.opts.maxWaitMs ?? 600_000)) throw new HttpError(res.status, url);
        await this.wait(ms);
        backoff *= 2;
        continue;
      }
      throw new HttpError(res.status, url);
    }
  }

  private async wait(ms: number): Promise<void> {
    this.waitedMs += ms;
    await this.clock.sleep(ms);
  }
}
