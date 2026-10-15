import { simpleGit, SimpleGit } from 'simple-git';
import { mkdtemp, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export type CloneResult = {
  dir: string;
  git: SimpleGit;
  isLocal: boolean;
  localPath?: string;
  defaultBranch: string;
};

export async function cloneRepo(source: string): Promise<CloneResult> {
  const base = await mkdtemp(join(tmpdir(), 'suturely-'));
  const dir = join(base, 'repo');
  const git = simpleGit();

  let cloneUrl = source;
  let isLocal = false;
  let localPath: string | undefined;

  if (await isDirectory(source)) {
    isLocal = true;
    localPath = resolve(source);
    // Local repos are cloned via file:// to keep git semantics consistent
    const normalized = localPath.replace(/\\/g, '/');
    cloneUrl = `file://${normalized}`;
    console.log(`   Local path detected: ${localPath}`);
  }

  await git.clone(cloneUrl, dir, ['--depth', '1']);
  const repoGit = simpleGit(dir);
  // Identity is required for git commits inside the temp clone
  await repoGit.addConfig('user.email', 'suturely@local');
  await repoGit.addConfig('user.name', 'suturely');

  const { stdout: branchOut } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  const defaultBranch = branchOut.trim() || 'main';

  return { dir, git: repoGit, isLocal, localPath, defaultBranch };
}