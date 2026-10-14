import { randomBytes } from 'node:crypto';

/** How long a dashboard URL from the tray stays valid. Long enough for a cold browser start. */
export const TOKEN_TTL_MS = 120_000;

/** Single-use tokens for `/?t=<token>`, kept in memory only. */
export class OneTimeTokens {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #issuedAt = new Map<string, number>();

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? TOKEN_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  issue(): string {
    const now = this.#now();
    for (const [token, issuedAt] of this.#issuedAt) {
      if (now - issuedAt > this.#ttlMs) this.#issuedAt.delete(token);
    }
    const token = randomBytes(32).toString('base64url');
    this.#issuedAt.set(token, now);
    return token;
  }

  /** True once for a token that was issued and hasn't expired. */
  consume(token: string): boolean {
    const issuedAt = this.#issuedAt.get(token);
    if (issuedAt === undefined) return false;
    this.#issuedAt.delete(token);
    return this.#now() - issuedAt <= this.#ttlMs;
  }
}
