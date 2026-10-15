import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PM } from './detect.js';
import type { OutdatedPkg } from './outdated.js';

const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const SMOKE_TIMEOUT_MS = 15 * 1000;

// Linters that we can optionally strip out of `npm test` when --skip-lint is set.
const LINT_CMD_RE = /^(xo|eslint|standard|prettier|biome|rome)\b/;

// System binaries must be called directly.
// Running them through npx makes npm download a *different* package with the same
// name from the registry (e.g. `npx node` pulls `node@26` from npm, not the local runtime).
const SYSTEM_BINS = new Set(['node', 'npm', 'npx', 'python', 'python3', 'go', 'cargo', 'ruby', 'java', 'tsc', 'tsx']);

export type TestResult = {
  ok: boolean;
  verified: boolean;
  cmd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  note?: string;
};

async function packageVersionInNodeModules(dir: string, pkg: string): Promise<string | null> {
  try {
    const p = join(dir, 'node_modules', pkg, 'package.json');
    const json = JSON.parse(await readFile(p, 'utf8'));
    return json.version ?? null;
  } catch {
    return null;
  }
}

async function canRequire(dir: string, pkg: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await execa('node', ['-e', `require('${pkg}'); console.log('OK')`], {
      cwd: dir,
      reject: false,
      timeout: 30_000,
    });
    return { ok: r.exitCode === 0, error: r.stderr?.slice(0, 500) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function runCommand(
  dir: string,
  cmd: string,
  args: string[],
  timeout = TEST_TIMEOUT_MS,
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const r = await execa(cmd, args, {
    cwd: dir,
    reject: false,
    all: true,
    timeout,
    stdin: 'ignore',
    // CI=true and NO_COLOR prevent interactive prompts and terminal flicker
    env: { ...process.env, CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const combined = (r as any).all ?? r.stdout ?? '';
  return {
    ok: r.exitCode === 0,
    exitCode: r.exitCode ?? 1,
    stdout: combined,
    stderr: r.stderr ?? '',
    timedOut: r.timedOut === true,
  };
}

function splitCommands(script: string, skipLint: boolean): string[] {
  const parts = script.split(/\s*&&\s*/).map((s) => s.trim()).filter(Boolean);
  if (!skipLint) return parts;
  return parts.filter((p) => !LINT_CMD_RE.test(p));
}

async function smokeTest(
  dir: string,
  pm: PM,
): Promise<{ ran: boolean; ok: boolean; note: string; output?: string }> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  if (!pkg.scripts?.start) {
    return { ran: false, ok: true, note: 'no start script' };
  }

  const r = await runCommand(dir, pm, ['start'], SMOKE_TIMEOUT_MS);
  const output = r.stdout.slice(0, 2000);

  if (r.timedOut) {
    return { ran: true, ok: true, note: `started and kept running (killed after ${SMOKE_TIMEOUT_MS / 1000}s)`, output };
  }
  if (r.exitCode === 0) {
    return { ran: true, ok: true, note: 'started and exited cleanly', output };
  }
  return { ran: true, ok: false, note: `crashed with exit ${r.exitCode}`, output };
}

export async function runTests(
  dir: string,
  pm: PM,
  target: OutdatedPkg,
  opts: { skipLint?: boolean; skipSmoke?: boolean } = {},
): Promise<TestResult> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};

  const commandsToRun: Array<{ display: string; cmd: string; args: string[] }> = [];

  if (scripts.test && !/no test/i.test(scripts.test)) {
    const testCmds = splitCommands(scripts.test, !!opts.skipLint);
    for (const c of testCmds) {
      const [bin, ...rest] = c.split(/\s+/);
      if (SYSTEM_BINS.has(bin)) {
        commandsToRun.push({ display: c, cmd: bin, args: rest });
      } else {
        commandsToRun.push({ display: `npx ${c}`, cmd: 'npx', args: [bin, ...rest] });
      }
    }
  }
  if (scripts.build) commandsToRun.push({ display: `${pm} run build`, cmd: pm, args: ['run', 'build'] });
  if (scripts.typecheck) commandsToRun.push({ display: `${pm} run typecheck`, cmd: pm, args: ['run', 'typecheck'] });
  if (scripts.lint && !opts.skipLint) commandsToRun.push({ display: `${pm} run lint`, cmd: pm, args: ['run', 'lint'] });

  if (commandsToRun.length > 0) {
    for (const c of commandsToRun) {
      const r = await runCommand(dir, c.cmd, c.args);
      if (!r.ok) {
        const note = r.timedOut ? `TIMED OUT after ${TEST_TIMEOUT_MS / 1000}s` : undefined;
        return { ok: false, verified: true, cmd: c.display, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, note };
      }
    }
    return { ok: true, verified: true, cmd: 'all scripts passed', exitCode: 0, stdout: '', stderr: '' };
  }

  // Fallback: no test scripts. Try a lightweight verification instead of pretending success.
  const notes: string[] = [];
  notes.push('no test scripts found');

  const installedVersion = await packageVersionInNodeModules(dir, target.name);
  const versionOk = installedVersion === target.latest;
  notes.push(`installed ${target.name}@${installedVersion ?? 'MISSING'} (target: ${target.latest})`);

  const reqResult = await canRequire(dir, target.name);
  notes.push(reqResult.ok ? 'require() OK' : `require() FAILED: ${reqResult.error}`);

  if (!versionOk || !reqResult.ok) {
    return {
      ok: false, verified: true, cmd: 'fallback-check', exitCode: 1,
      stdout: notes.join('\n'), stderr: reqResult.error ?? '',
      note: 'fallback verification failed',
    };
  }

  // Even without tests, `npm start` can catch gross runtime errors.
  if (!opts.skipSmoke) {
    console.log('   Running smoke test (npm start)...');
    const smoke = await smokeTest(dir, pm);
    if (smoke.ran) {
      notes.push(`smoke: ${smoke.note}`);
      if (smoke.output) {
        const preview = smoke.output.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n');
        notes.push(`--- smoke output (head) ---\n${preview}`);
      }
      if (!smoke.ok) {
        return {
          ok: false, verified: true, cmd: 'smoke-test (npm start)', exitCode: 1,
          stdout: notes.join('\n'), stderr: smoke.output ?? '',
          note: 'app crashed on startup',
        };
      }
      return {
        ok: true, verified: false, cmd: 'fallback+smoke',
        exitCode: 0, stdout: notes.join('\n'), stderr: '',
        note: 'no real tests — smoke passed, result UNVERIFIED',
      };
    }
  }

  return {
    ok: true, verified: false, cmd: 'fallback-check', exitCode: 0,
    stdout: notes.join('\n'), stderr: '',
    note: 'no real tests — result is UNVERIFIED',
  };
}