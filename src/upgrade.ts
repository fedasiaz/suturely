import { execa } from 'execa';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PM } from './detect.js';
import type { OutdatedPkg } from './outdated.js';

export async function applyUpgrade(dir: string, pm: PM, pkg: OutdatedPkg) {
  const pkgPath = join(dir, 'package.json');
  const json = JSON.parse(await readFile(pkgPath, 'utf8'));

  let section: 'dependencies' | 'devDependencies' | null = null;
  if (json.dependencies?.[pkg.name]) section = 'dependencies';
  else if (json.devDependencies?.[pkg.name]) section = 'devDependencies';

  if (!section) {
    throw new Error(`${pkg.name} not found in dependencies or devDependencies of package.json`);
  }

  const oldSpec = json[section][pkg.name];
  json[section][pkg.name] = `^${pkg.latest}`;
  await writeFile(pkgPath, JSON.stringify(json, null, 2) + '\n');

  console.log(`   package.json: ${pkg.name} (${section}) ${oldSpec} → ^${pkg.latest}`);
  console.log(`   Running ${pm} install...`);

  const r = await execa(pm, ['install', '--no-audit', '--no-fund'], {
    cwd: dir,
    reject: false,
    all: true,
  });

  console.log(`   install exit code: ${r.exitCode}`);

  if (r.exitCode !== 0) {
    console.log('   install stderr (first 800 chars):');
    console.log((r.stderr ?? '').slice(0, 800));
    console.log('   install combined output (first 800 chars):');
    console.log(((r as any).all ?? r.stdout ?? '').slice(0, 800));
  }
}