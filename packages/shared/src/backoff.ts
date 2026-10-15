/** Delay before reconnect attempt `attempt` (0-based): 0.5 s, doubling, capped at 10 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 10_000);
}
