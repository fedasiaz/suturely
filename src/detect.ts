import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type PM = 'npm' | 'yarn' | 'pnpm';

export async function detectPM(dir: string): Promise<PM> {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function findMonorepoPackages(rootDir: string): string[] {
  const packages: string[] = [];
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt']);

  function walk(dir: string, depth: number) {
    if (depth > 3) return; // Don't go too deep
    if (!existsSync(dir)) return;
    const stat = statSync(dir);
    if (!stat.isDirectory()) return;

    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath) && dir !== rootDir) {
      packages.push(dir);
    }

    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (ignoreDirs.has(entry)) continue;
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  }
  
  walk(rootDir, 0);
  return packages;
}