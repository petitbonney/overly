import path from 'node:path';

export interface DataDirInput {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homedir: string;
  /** Relative overrides resolve against this directory. */
  cwd: string;
  /** From `--data-dir`. */
  override?: string | undefined;
}

/**
 * Where Overly keeps its settings, logs and documents. `--data-dir` wins over `OVERLY_DATA_DIR`,
 * which wins over the OS default. Path rules follow `platform`, so every OS can be tested anywhere.
 */
export function resolveDataDir(input: DataDirInput): string {
  const { platform, env, homedir, cwd, override } = input;
  const p = platform === 'win32' ? path.win32 : path.posix;

  const explicit = override ?? env['OVERLY_DATA_DIR'];
  if (explicit !== undefined && explicit !== '') return p.resolve(cwd, explicit);

  switch (platform) {
    case 'win32':
      return p.join(env['APPDATA'] ?? p.join(homedir, 'AppData', 'Roaming'), 'Overly');
    case 'darwin':
      return p.join(homedir, 'Library', 'Application Support', 'Overly');
    default: {
      const xdg = env['XDG_DATA_HOME'];
      return p.join(
        xdg !== undefined && xdg !== '' ? xdg : p.join(homedir, '.local', 'share'),
        'overly',
      );
    }
  }
}
