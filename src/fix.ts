import { execa } from 'execa';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { OutdatedPkg } from './outdated.js';
import type { TestResult } from './test.js';

// IMPORTANT: never hoist this to a module-level constant.
// ESM imports are evaluated before dotenv.config() runs in index.ts,
// so process.env would be empty when this module is first loaded.
// Reading env inside the function guarantees dotenv has already run.
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
            content:
              'You are a senior software engineer. You fix broken dependency upgrades. Respond ONLY with a single JSON object, no markdown fences, no explanations outside JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Unexpected response shape: ' + JSON.stringify(data).slice(0, 300));
    }
    return content;
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
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function tryFix(
  dir: string,
  pkg: OutdatedPkg,
  result: TestResult,
): Promise<{ applied: boolean; summary?: string }> {
  const { apiKey } = getConfig();
  if (!apiKey) {
    return { applied: false, summary: 'LLM_API_KEY (or GEMINI_API_KEY) is not set in .env' };
  }

  // Collect the list of files actually tracked by git.
  // Used to validate LLM-proposed edits — the model can hallucinate paths.
  const { stdout: lsOut } = await execa('git', ['ls-files'], { cwd: dir, reject: false });
  const allFiles = (lsOut ?? '')
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|js|tsx|jsx|json|mjs|cjs)$/.test(f))
    .filter((f) => !f.startsWith('node_modules/'))
    .filter((f) => !f.includes('package-lock.json'))
    .slice(0, 60);

  // Find source files that reference the upgraded package
  let referenced: string[] = [];
  try {
    const r = await execa(
      'grep',
      ['-rl', pkg.name, '.', '--include=*.ts', '--include=*.js', '--include=*.tsx', '--include=*.jsx', '--include=*.mjs', '--include=*.cjs', '--exclude-dir=node_modules'],
      { cwd: dir, reject: false },
    );
    referenced = (r.stdout ?? '').split('\n').filter(Boolean).slice(0, 10);
  } catch {}

  const fileSnippets: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  for (const f of referenced) {
    if (seen.has(f)) continue;
    seen.add(f);
    try {
      const content = await readFile(join(dir, f), 'utf8');
      fileSnippets.push({ path: f, content: content.slice(0, 6000) });
    } catch {}
  }

  const prompt = `You are fixing a broken dependency upgrade.

Package: ${pkg.name}
Upgraded from: ${pkg.current}
Upgraded to: ${pkg.latest}

ERROR OUTPUT (${result.cmd}, exit ${result.exitCode}):
${result.stderr || result.stdout}

Files in the repo that reference "${pkg.name}":
${fileSnippets.length ? fileSnippets.map((f) => `\n--- ${f.path} ---\n${f.content}`).join('\n') : '(none found by grep — check test files at root!)'}

ALL FILES in the repo (you may only edit these):
${allFiles.join('\n')}

CRITICAL RULES:
1. The "path" field MUST be an exact relative path from the "ALL FILES" list above.
2. Do NOT invent paths. Do NOT use placeholder names like "src/foo.ts" or "example.js".
3. If the broken test is at root (e.g. "test-fetch.js"), use EXACTLY that path.
4. Provide the FULL new content of each file you edit — not a diff, not a snippet.

Respond ONLY with a JSON object:
{
  "edits": [
    { "path": "<exact path from ALL FILES list>", "content": "<full new file content>" }
  ],
  "summary": "one-line explanation of the fix"
}

If you cannot fix it, return { "edits": [], "summary": "reason" }.`;

  let text = '{}';
  try {
    text = await callLLM(prompt);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error('   LLM API error:', msg.slice(0, 300));
    return { applied: false, summary: `LLM API error: ${msg.slice(0, 200)}` };
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error('   LLM returned non-JSON:', text.slice(0, 300));
    return { applied: false, summary: 'LLM returned invalid JSON' };
  }

  if (!payload.edits?.length) {
    return { applied: false, summary: payload.summary ?? 'no edits proposed' };
  }

  // Apply edits, but validate each path first.
  // The model occasionally proposes paths that don't exist — skip them instead of crashing.
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const edit of payload.edits) {
    if (!edit?.path || typeof edit.path !== 'string') {
      skipped.push('<no path>');
      continue;
    }
    const normalized = edit.path.replace(/\\/g, '/').replace(/^\.\//, '');
    const fullPath = join(dir, normalized);

    const inAllFiles = allFiles.includes(normalized);
    const exists = await fileExists(fullPath);

    if (!inAllFiles && !exists) {
      skipped.push(`${normalized} (not in repo)`);
      continue;
    }

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, edit.content ?? '');
      applied.push(normalized);
    } catch (e: any) {
      skipped.push(`${normalized} (write failed: ${e?.message ?? ''})`);
    }
  }

  console.log(`   LLM proposed ${payload.edits.length} edit(s):`);
  if (applied.length) console.log(`     applied: ${applied.join(', ')}`);
  if (skipped.length) console.log(`     skipped: ${skipped.join(', ')}`);

  if (applied.length === 0) {
    return {
      applied: false,
      summary: `no valid edits (skipped: ${skipped.join('; ')})`,
    };
  }

  return { applied: true, summary: payload.summary ?? `edited ${applied.join(', ')}` };
}