import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectPM, type PM } from './detect.js';

describe('detectPM', () => {
  let dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  async function makeDir(files: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'suturely-detect-'));
    for (const file of files) {
      await writeFile(join(dir, file), '');
    }
    return dir;
  }

  it("returns 'pnpm' when a directory has pnpm-lock.yaml", async () => {
    const dir = await makeDir(['pnpm-lock.yaml', 'package.json']);
    dirs.push(dir);

    const pm: PM = await detectPM(dir);
    assert.equal(pm, 'pnpm');
  });

  it("returns 'yarn' when a directory has yarn.lock", async () => {
    const dir = await makeDir(['yarn.lock', 'package.json']);
    dirs.push(dir);

    const pm: PM = await detectPM(dir);
    assert.equal(pm, 'yarn');
  });

  it("returns 'npm' when a directory has only package.json", async () => {
    const dir = await makeDir(['package.json']);
    dirs.push(dir);

    const pm: PM = await detectPM(dir);
    assert.equal(pm, 'npm');
  });
});