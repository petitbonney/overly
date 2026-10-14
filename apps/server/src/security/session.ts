import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'overly_session';

/** 30 days. */
export const SESSION_MAX_AGE_SECONDS = 2_592_000;

/** `<random id>.<issued-at ms>`. The cookie layer signs it. */
export function createSessionValue(now: number): string {
  return `${randomBytes(16).toString('base64url')}.${String(now)}`;
}

export function isSessionValueFresh(value: string, now: number): boolean {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return false;
  const issuedAt = value.slice(dot + 1);
  if (!/^\d+$/.test(issuedAt)) return false;
  const age = now - Number(issuedAt);
  return age >= 0 && age <= SESSION_MAX_AGE_SECONDS * 1000;
}
