import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function runTests(dir, pm) {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const scripts = pkg.scripts ?? {};
    // приоритет: test → build → typecheck
    const candidates = [];
    if (scripts.test && !/no test/i.test(scripts.test))
        candidates.push([pm, ['test']]);
    if (scripts.build)
        candidates.push([pm, ['run', 'build']]);
    if (scripts.typecheck)
        candidates.push([pm, ['run', 'typecheck']]);
    if (scripts.lint)
        candidates.push([pm, ['run', 'lint']]);
    if (candidates.length === 0) {
        return { ok: true, cmd: 'none', exitCode: 0, stdout: '', stderr: 'no test scripts' };
    }
    for (const [cmd, args] of candidates) {
        const r = await execa(cmd, args, { cwd: dir, reject: false, all: true });
        const stdout = r.all ?? r.stdout ?? '';
        const stderr = r.stderr ?? '';
        if (r.exitCode !== 0) {
            return { ok: false, cmd: `${cmd} ${args.join(' ')}`, exitCode: r.exitCode ?? 1, stdout, stderr };
        }
    }
    return { ok: true, cmd: 'all passed', exitCode: 0, stdout: '', stderr: '' };
}
