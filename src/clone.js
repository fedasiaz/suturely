import { simpleGit } from 'simple-git';
import { mkdtemp } from 'tmp-promise';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export async function cloneRepo(url) {
    const { path: base } = await mkdtemp(join(tmpdir(), 'orch-'));
    const dir = join(base, 'repo');
    const git = simpleGit();
    await git.clone(url, dir, ['--depth', '1']);
    const repoGit = simpleGit(dir);
    // нужна идентичность для коммитов
    await repoGit.addConfig('user.email', 'orch@local');
    await repoGit.addConfig('user.name', 'orchestrator');
    return { dir, git: repoGit };
}
