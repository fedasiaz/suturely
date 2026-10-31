import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OutdatedPkg } from './outdated.js';

function getConfig() {
  return {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
    model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
    apiKey: process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '',
  };
}

export async function generateReleaseNotes(dir: string, target: OutdatedPkg, finalOk: boolean, verified: boolean): Promise<string> {
  const { baseUrl, model, apiKey } = getConfig();
  if (!apiKey) return `Automated dependency upgrade by suturely.`;

  let diff = '';
  try {
    const r = await execa('git', ['diff', '--', 'package.json', 'package-lock.json'], { cwd: dir, reject: false });
    diff = r.stdout ?? '';
  } catch {}

  const prompt = `Write a professional, short pull request description for a dependency upgrade.
Package: ${target.name}
From: ${target.current}
To: ${target.latest}

Diff:
${diff.slice(0, 3000)}

Result: ${verified ? (finalOk ? 'Tests passed (GREEN)' : 'Tests failed (RED)') : 'Unverified (No tests)'}

Include a short summary of what changed and the verification status. Use markdown.`;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error('HTTP error');
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text) return text;
  } catch {}

  return `Automated dependency upgrade by suturely.\n\n**Package:** \`${target.name}\`\n**From:** \`${target.current}\`\n**To:** \`${target.latest}\`\n**Result:** ${verified ? (finalOk ? 'GREEN' : 'RED') : 'UNVERIFIED'}`;
}