import { execa } from 'execa';

const GH_API = 'https://api.github.com';

export function parseGitHubRemote(remote: string): { owner: string; repo: string } | null {
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function getDefaultBranch(owner: string, repo: string, token: string): Promise<string> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return 'main';
  const data: any = await res.json();
  return data.default_branch ?? 'main';
}

export async function createPR(opts: {
  dir: string;
  branch: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  token: string;
}): Promise<{ url: string }> {
  const { dir, branch, owner, repo, title, body, token } = opts;

  const { stdout: remoteUrl } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: dir });
  const cleanRemote = remoteUrl.trim();

  let pushUrl = cleanRemote;
  if (cleanRemote.startsWith('https://github.com/')) {
    pushUrl = cleanRemote.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
  } else if (cleanRemote.startsWith('git@github.com:')) {
    pushUrl = cleanRemote.replace('git@github.com:', `https://x-access-token:${token}@github.com/`);
  } else {
    throw new Error(`Unsupported remote URL: ${cleanRemote}`);
  }

  console.log(`   Pushing branch ${branch}...`);

  // Вызываем git с аргументами, но БЕЗ вывода команды в лог при ошибке.
  // Плюс явно маскируем токен, если он всё же где-то появится.
  const r = await execa('git', ['push', pushUrl, `${branch}:${branch}`], {
    cwd: dir,
    reject: false,
    all: true,
  });

  if (r.exitCode !== 0) {
    const combined = ((r as any).all ?? '').replaceAll(token, '***');
    const short = combined.split('\n').slice(-6).join('\n');
    throw new Error(`git push failed (exit ${r.exitCode}):\n${short}`);
  }

  const base = await getDefaultBranch(owner, repo, token);
  console.log(`   Creating PR against ${owner}/${repo}:${base}...`);

  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, head: branch, base, body }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub PR creation failed: ${res.status} ${txt.slice(0, 400)}`);
  }
  const data: any = await res.json();
  return { url: data.html_url };
}