import { execa } from 'execa';
import type { PM } from './detect.js';

export type OutdatedPkg = {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: 'dependencies' | 'devDependencies';
};

export async function getOutdated(dir: string, pm: PM): Promise<OutdatedPkg[]> {
  try {
    const r = await execa(pm, ['outdated', '--json'], {
      cwd: dir,
      reject: false,
      all: true,
    });

    const combined = (r as any).all ?? r.stdout ?? '';
    if (!combined.trim()) return [];

    const start = combined.indexOf('{');
    const end = combined.lastIndexOf('}');
    if (start === -1 || end === -1) return [];
    const clean = combined.slice(start, end + 1);

    let raw: Record<string, any>;
    try {
      raw = JSON.parse(clean);
    } catch {
      return [];
    }

    const result: OutdatedPkg[] = [];
    for (const [name, v] of Object.entries(raw)) {
      const info = v as any;
      if (!info?.current || !info?.latest) continue;
      if (typeof info.current !== 'string' || typeof info.latest !== 'string') continue;
      result.push({
        name,
        current: info.current,
        wanted: info.wanted ?? info.current,
        latest: info.latest,
        type: info.type === 'devDependencies' ? 'devDependencies' : 'dependencies',
      });
    }
    return result;
  } catch {
    return [];
  }
}

function majorOf(version: string): string {
  return String(version).replace(/^[^\d]*/, '').split('.')[0];
}

export function pickTarget(
  pkgs: OutdatedPkg[],
  filterPackage?: string,
): OutdatedPkg | null {
  if (pkgs.length === 0) return null;

  if (filterPackage) {
    const match = pkgs.find((p) => p.name === filterPackage);
    if (!match) {
      console.log(`   [warn] ${filterPackage} is not outdated (or not found).`);
      return null;
    }
    return match;
  }

  const major = pkgs.filter((p) => majorOf(p.current) !== majorOf(p.latest));
  return major[0] ?? pkgs[0];
}

export function pickAllMajor(pkgs: OutdatedPkg[]): OutdatedPkg[] {
  return pkgs.filter((p) => majorOf(p.current) !== majorOf(p.latest));
}