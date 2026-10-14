import { execa } from 'execa';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function applyUpgrade(dir, pm, pkg) {
    // меняем версию в package.json вручную — так надёжнее, чем install@latest
    const pkgPath = join(dir, 'package.json');
    const json = JSON.parse(await readFile(pkgPath, 'utf8'));
    const section = json[pkg.type] ? pkg.type : 'dependencies';
    if (json[section]?.[pkg.name]) {
        json[section][pkg.name] = `^${pkg.latest}`;
    }
    await writeFile(pkgPath, JSON.stringify(json, null, 2) + '\n');
    const installCmd = pm === 'npm' ? 'install' : 'install';
    await execa(pm, [installCmd], { cwd: dir, reject: false });
}
