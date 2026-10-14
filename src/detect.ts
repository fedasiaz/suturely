import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PM = 'npm' | 'yarn' | 'pnpm';

export async function detectPM(dir: string): Promise<PM> {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}