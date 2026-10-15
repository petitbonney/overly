import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 12;
/** The largest multiple of 36 below 256: bytes from here up would favor the first letters. */
const LIMIT = 252;

/** A widget or asset ID: 12 random characters from `[a-z0-9]` (about 62 bits). */
export function randomId(): string {
  let id = '';
  while (id.length < LENGTH) {
    for (const byte of randomBytes(LENGTH * 2)) {
      if (byte >= LIMIT) continue;
      id += ALPHABET.charAt(byte % ALPHABET.length);
      if (id.length === LENGTH) break;
    }
  }
  return id;
}
