import { execa } from 'execa';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { OutdatedPkg } from './outdated.js';
import type { TestResult } from './test.js';

function getConfig() {
  return {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
    model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
    apiKey: process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '',
  };
}

async function callLLMOnce(prompt: string): Promise<string> {
  const { baseUrl, model, apiKey } = getConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a senior software engineer. Respond ONLY with a single JSON object, no markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || '{}';
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(prompt: string): Promise<string> {
  try {
    return await callLLMOnce(prompt);
  } catch (e: any) {
    console.log('   retry after:', e?.message?.slice(0, 100));
    await new Promise((r) => setTimeout(r, 2000));
    return await callLLMOnce(prompt);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

export async function tryFix(
  dir: string,
  pkg: OutdatedPkg,
  result: TestResult,
): Promise<{ applied: boolean; summary?: string }> {
  const { apiKey } = getConfig();
  if (!apiKey) return { applied: false, summary: 'LLM_API_KEY not set' };

  const { stdout: lsOut } = await execa('git', ['ls-files'], { cwd: dir, reject: false });
  const allFiles = (lsOut ?? '').split('\n').filter(Boolean).filter((f) => /\.(ts|js|tsx|jsx|json|mjs|cjs)$/.test(f)).filter((f) => !f.startsWith('node_modules/')).slice(0, 60);

  const testFilePath = join(dir, 'generated.test.js');
  let testFileContent = '';
  if (await fileExists(testFilePath)) {
    testFileContent = await readFile(testFilePath, 'utf8');
    if (!allFiles.includes('generated.test.js')) allFiles.push('generated.test.js');
  }

  let referenced: string[] = [];
  try {
    const r = await execa('grep', ['-rl', pkg.name, '.', '--include=*.ts', '--include=*.js', '--exclude-dir=node_modules'], { cwd: dir, reject: false });
    referenced = (r.stdout ?? '').split('\n').filter(Boolean).slice(0, 10);
  } catch {}

  const fileSnippets: Array<{ path: string; content: string }> = [];
  for (const f of referenced) {
    try { fileSnippets.push({ path: f, content: (await readFile(join(dir, f), 'utf8')).slice(0, 6000) }); } catch {}
  }

  const prompt = `You are fixing a broken dependency upgrade.
Package: ${pkg.name}
Upgraded from: ${pkg.current} to: ${pkg.latest}

ERROR OUTPUT:
${result.stderr || result.stdout}

${testFileContent ? `\n--- Content of generated.test.js ---\n${testFileContent}\n` : ''}

ALL FILES (you may only edit these):
${allFiles.join('\n')}

CRITICAL RULES:
1. The "path" MUST be from the ALL FILES list.
2. DO NOT edit package.json or package-lock.json.
3. If the error is an assertion failure like 'actual: object, expected: function', it means the package is ESM-only and require() is returning the module object. You MUST fix the test file (generated.test.js) by using dynamic import: const fetch = (await import('node-fetch')).default;
4. Provide the FULL new content of each file.

Respond ONLY with a JSON object:
{ "edits": [{ "path": "...", "content": "..." }], "summary": "..." }`;

  let text = '{}';
  try { text = await callLLM(prompt); } catch (e: any) { return { applied: false, summary: `LLM Error: ${e.message}` }; }

  let payload: any;
  try { payload = JSON.parse(text); } catch { return { applied: false, summary: 'Invalid JSON' }; }

  if (!payload.edits?.length) return { applied: false, summary: payload.summary ?? 'no edits' };

  const applied: string[] = [];
  for (const edit of payload.edits) {
    const normalized = edit.path.replace(/\\/g, '/').replace(/^\.\//, '');
    // Block all config and lockfiles
    if (normalized === 'package.json' || normalized.includes('package-lock.json') || normalized.includes('yarn.lock') || normalized.includes('pnpm-lock.yaml')) {
      continue;
    }
    const fullPath = join(dir, normalized);
    if (allFiles.includes(normalized) || await fileExists(fullPath)) {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, edit.content ?? '');
      applied.push(normalized);
    }
  }

  if (applied.length === 0) return { applied: false, summary: 'no valid edits (LLM tried to edit lockfiles or invalid paths)' };
  return { applied: true, summary: payload.summary ?? `edited ${applied.join(', ')}` };
}

export async function generateTest(dir: string, targetPkg: string): Promise<{ created: boolean; summary?: string }> {
  const { apiKey } = getConfig();
  if (!apiKey) return { created: false, summary: 'No API key' };

  const pkgJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const isESM = pkgJson.type === 'module';
  
  const { stdout: lsOut } = await execa('git', ['ls-files'], { cwd: dir, reject: false });
  const allFiles = (lsOut ?? '').split('\n').filter(Boolean).filter((f) => /\.(ts|js|tsx|jsx|mjs|cjs)$/.test(f)).filter((f) => !f.startsWith('node_modules/'));

  const currentVersion = pkgJson.dependencies?.[targetPkg] || pkgJson.devDependencies?.[targetPkg] || 'unknown';

  const prompt = `The project has no test script. Write a REAL smoke test for the package "${targetPkg}".
Use the built-in 'node:test' and 'node:assert' modules.

Here are the files in the project:
${allFiles.join('\n')}

CRITICAL RULES:
1. ${isESM ? 'The project is ESM. Use import syntax.' : 'The project is CommonJS. You MUST use require() syntax. Do NOT use import.'}
2. DO NOT write dummy tests like 'assert.strictEqual(1, 1)'. I will reject them.
3. You MUST import "${targetPkg}" and check its main functionality. For "node-fetch" v2, the correct check is: const fetch = require('node-fetch'); assert.strictEqual(typeof fetch, 'function');
4. The test MUST pass on the CURRENT codebase with version ${currentVersion}.
Save the file as 'generated.test.js'.

Respond ONLY with a JSON object:
{ "edits": [{ "path": "generated.test.js", "content": "..." }], "summary": "Created real smoke test" }`;

  let text = '{}';
  try { text = await callLLM(prompt); } catch { return { created: false, summary: 'LLM failed' }; }
  
  let payload: any;
  try { payload = JSON.parse(text); } catch { return { created: false, summary: 'Invalid JSON' }; }

  if (payload.edits?.length) {
    for (const edit of payload.edits) {
      await writeFile(join(dir, edit.path), edit.content);
    }
    return { created: true, summary: payload.summary };
  }
  return { created: false, summary: 'LLM did not provide edits' };
}