import { expect, it } from 'vitest';

import { acceptForKinds, assetTypeForName } from './assets.js';

it('finds asset types by extension, case-insensitively', () => {
  expect(assetTypeForName('A.PNG')).toEqual({ ext: '.png', kind: 'image', mime: 'image/png' });
  expect(assetTypeForName('Mon son É.mp3')).toEqual({
    ext: '.mp3',
    kind: 'audio',
    mime: 'audio/mpeg',
  });
  expect(assetTypeForName('clip.webm')).toMatchObject({ kind: 'video' });
  expect(assetTypeForName('font.WOFF2')).toMatchObject({ kind: 'font', mime: 'font/woff2' });
  expect(assetTypeForName('logo.svg')).toMatchObject({ mime: 'image/svg+xml' });
});

it.each(['x.exe', 'noext', '.png.', 'archive.tar.gz', 'toString', 'a.constructor'])(
  'has no type for %s',
  (name) => {
    expect(assetTypeForName(name)).toBeUndefined();
  },
);

it('builds an accept list for audio', () => {
  const accept = acceptForKinds(['audio']).split(',');
  expect(accept).toContain('.mp3');
  expect(accept).toContain('.flac');
  expect(accept).not.toContain('.png');
});
