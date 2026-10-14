import { describe, expect, it } from 'vitest';

import { PRODUCT_NAME, TWITCH_CLIENT_ID } from './index.js';

describe('@overly/shared', () => {
  it('exports the product name', () => {
    expect(PRODUCT_NAME).toBe('Overly');
  });

  it('ships a Twitch Client ID in the format Twitch issues', () => {
    expect(TWITCH_CLIENT_ID).toMatch(/^[a-z0-9]{30}$/);
  });
});
