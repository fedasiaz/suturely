import { GoogleGenAI } from '@google/genai';
import { execa } from 'execa';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export async function tryFix(dir, pkg, result) {
    const { stdout: diff } = await execa('git', ['diff', '--', 'package.json', 'package-lock.json'], { cwd: dir, reject: false });
    const { stdout: grepOut } = await execa('grep', ['-rl', pkg.name, 'src', '.', '--include=*.ts', '--include=*.js', '--include=*.tsx', '--include=*.jsx'], { cwd: dir, reject: false });
    const files = grepOut.split('\n').filter(Boolean).slice(0, 10);
    const fileSnippets = [];
    for (const f of files) {
        try {
            const content = await readFile(join(dir, f), 'utf8');
            fileSnippets.push({ path: f, content: content.slice(0, 6000) });
        }
        catch { }
    }
    const prompt = `You are fixing a broken dependency upgrade.

Package: ${pkg.name}
Upgraded from: ${pkg.current}
Upgraded to: ${pkg.latest}

package.json diff:
${diff}

Error output (${result.cmd}, exit ${result.exitCode}):
${result.stderr || result.stdout}

Files referencing the package:
${fileSnippets.map((f) => `\n--- ${f.path} ---\n${f.content}`).join('\n')}

Respond ONLY with a JSON object:
{
  "edits": [
    { "path": "src/foo.ts", "content": "<full new file content>" }
  ],
  "summary": "one-line explanation of the fix"
}

If you cannot fix it, return { "edits": [], "summary": "reason" }.`;
    const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            temperature: 0,
        },
    });
    const text = res.text ?? '{}';
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
        return { applied: false, summary: 'LLM returned invalid JSON' };
    }
    if (!payload.edits?.length) {
        return { applied: false, summary: payload.summary };
    }
    for (const edit of payload.edits) {
        await writeFile(join(dir, edit.path), edit.content);
    }
    return { applied: true, summary: payload.summary };
}
