import { expect, it } from 'vitest';

import { NAME } from './index.js';

// Placeholder: proves the workspace builds and resolves @overly/shared.
it('resolves the shared package', () => {
  expect(NAME).toBe('Overly dashboard');
});
