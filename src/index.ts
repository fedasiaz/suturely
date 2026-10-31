import dotenv from 'dotenv';
dotenv.config({ override: true });

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { SimpleGit } from 'simple-git';
import { cloneRepo } from './clone.js';
import { detectPM, findMonorepoPackages, type PM } from './detect.js';
import { getOutdated, pickTarget, pickAllMajor, type OutdatedPkg } from './outdated.js';
import { applyUpgrade } from './upgrade.js';
import { runTests } from './test.js';
import { tryFix, generateTest } from './fix.js';
import { printReport } from './report.js';
import { generateHtmlReport } from './report-html.js'; // NEW
import { generateReleaseNotes } from './release-notes.js'; // NEW
import { createPR, parseGitHubRemote } from './pr.js';
import { runInteractive } from './interactive.js';
import { loadConfig } from './config.js';

type Args = {
  source: string; filterPackage?: string; pushPr: boolean; dryRun: boolean;
  skipBaseline: boolean; skipLint: boolean; skipSmoke: boolean; allMajor: boolean;
};

async function getArgs(): Promise<Args> {
  if (process.argv.length > 2) {
    const out: Args = { source: '', pushPr: false, dryRun: false, skipBaseline: false, skipLint: false, skipSmoke: false, allMajor: false };
    for (const a of process.argv.slice(2)) {
      if (a.startsWith('--package=')) out.filterPackage = a.slice('--package='.length);
      else if (a === '--push-pr') out.pushPr = true;
      else if (a === '--dry-run') out.dryRun = true;
      else if (a === '--skip-baseline') out.skipBaseline = true;
      else if (a === '--skip-lint') out.skipLint = true;
      else if (a === '--no-smoke') out.skipSmoke = true;
      else if (a === '--all-major') out.allMajor = true;
      else if (!a.startsWith('--') && !out.source) out.source = a;
    }
    if (!out.source) { console.error('Usage: node dist/index.js <repo> [flags]'); process.exit(1); }
    return out;
  }
  console.log('\nWelcome to suturely!\n');
  const interactive = await runInteractive();
  return { source: interactive.source, filterPackage: interactive.filterPackage, pushPr: interactive.pushPr, dryRun: !interactive.pushPr, skipBaseline: false, skipLint: interactive.skipLint, skipSmoke: false, allMajor: false };
}

async function pushAndCreatePR(dir: string, git: SimpleGit, branch: string, target: OutdatedPkg, finalOk: boolean, verified: boolean): Promise<string | undefined> {
  try {
    await git.addConfig('user.email', 'suturely@local');
    await git.addConfig('user.name', 'suturely');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '-m', `chore: upgrade ${target.name} ${target.current} -> ${target.latest}`], { cwd: dir, reject: false });
  } catch { return undefined; }

  const { stdout: remoteUrl } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: dir, reject: false });
  const parsed = parseGitHubRemote(remoteUrl ?? '');
  if (!parsed) return undefined;

  const title = `chore(deps): upgrade ${target.name} ${target.current} -> ${target.latest}`;
  console.log(`   Generating Release Notes via AI...`);
  const body = await generateReleaseNotes(dir, target, finalOk, verified);

  try {
    const pr = await createPR({ dir, branch, owner: parsed.owner, repo: parsed.repo, title, body, token: process.env.GITHUB_TOKEN! });
    console.log(`   PR created: ${pr.url}`);
    return pr.url;
  } catch (e: any) { return undefined; }
}

async function processOnePackage(targetDir: string, pm: PM, git: SimpleGit, defaultBranch: string, target: OutdatedPkg, args: Args): Promise<any> {
  const rep: any = { target, steps: [] };
  try {
    await git.checkout(defaultBranch);
    await git.reset(['--hard', `origin/${defaultBranch}`]);
    await execa(pm, ['install', '--no-audit', '--no-fund'], { cwd: targetDir, reject: false });
  } catch {}

  const safeName = target.name.replace(/[^a-zA-Z0-9-]/g, '-');
  const branch = `suturely/upgrade-${safeName}-${Date.now()}`;
  rep.branch = branch;
  await git.checkoutLocalBranch(branch);

  console.log(`   Upgrading ${target.name}...`);
  await applyUpgrade(targetDir, pm, target);

  console.log(`   Running tests after upgrade...`);
  const testOpts = { skipLint: args.skipLint, skipSmoke: args.skipSmoke };
  let testResult = await runTests(targetDir, pm, target, testOpts);
  rep.steps.push({ phase: 'after-upgrade', ...testResult });

  let attempt = 0;
  let lastOutput = testResult.stdout + testResult.stderr;
  while (!testResult.ok && testResult.verified && attempt < 3) {
    attempt++;
    console.log(`   Fix attempt ${attempt}/3...`);
    let fix: { applied: boolean; summary?: string };
    try { fix = await tryFix(targetDir, target, testResult); } catch (e: any) { fix = { applied: false, summary: e.message }; }
    if (!fix.applied) { console.log('   LLM failed:', fix.summary); break; }
    console.log('   Applied fix:', fix.summary);
    testResult = await runTests(targetDir, pm, target, testOpts);
    rep.steps.push({ phase: `fix-${attempt}`, ...testResult });
    if (testResult.stdout + testResult.stderr === lastOutput && !testResult.ok) break;
    lastOutput = testResult.stdout + testResult.stderr;
  }

  rep.finalOk = testResult.ok;
  rep.verified = testResult.verified;

  if (!args.dryRun && args.pushPr) {
    const prUrl = await pushAndCreatePR(targetDir, git, branch, target, testResult.ok, testResult.verified);
    if (prUrl) rep.prUrl = prUrl;
  }
  return rep;
}

async function main() {
  const config = await loadConfig();
  if (config.apiKey && !process.env.LLM_API_KEY) process.env.LLM_API_KEY = config.apiKey;
  if (config.baseUrl && !process.env.LLM_BASE_URL) process.env.LLM_BASE_URL = config.baseUrl;
  if (config.model && !process.env.LLM_MODEL) process.env.LLM_MODEL = config.model;

  const args = await getArgs();
  const report: any = { repo: args.source, skipLint: args.skipLint, allMajor: args.allMajor };

  console.log(`\nPreparing source: ${args.source}`);
  const { dir, git, isLocal, defaultBranch } = await cloneRepo(args.source);
  report.dir = dir; report.isLocal = isLocal; console.log(`   Default branch: ${defaultBranch}`);

  let targetDir = dir;
  if (!existsSync(join(dir, 'package.json'))) {
    console.log(`\n   No root package.json. Searching monorepo...`);
    const packages = findMonorepoPackages(dir);
    if (packages.length === 0) { console.error('   No packages found.'); return; }
    targetDir = packages[0];
    console.log(`   ✓ Found ${packages.length} packages. Targeting: ${targetDir}`);
  }

  const pm = await detectPM(targetDir);
  report.pm = pm; console.log(`   Package manager: ${pm}`);

  console.log(`\nInstalling dependencies...`);
  await execa(pm, ['install', '--no-audit', '--no-fund'], { cwd: targetDir, reject: false });

  console.log(`\nChecking outdated...`);
  const outdated = await getOutdated(targetDir, pm);
  let targets: OutdatedPkg[] = [];
  
  if (args.allMajor) {
    targets = pickAllMajor(outdated).filter((p) => !args.filterPackage || p.name === args.filterPackage);
    console.log(`   Found ${targets.length} major upgrades.`);
  } else {
    const t = pickTarget(outdated, args.filterPackage);
    if (t) targets = [t];
  }

  if (targets.length === 0) { console.log('   Nothing to upgrade. Done.'); return; }

  const pkgJson = JSON.parse(await (await import('node:fs/promises')).readFile(join(targetDir, 'package.json'), 'utf8'));
  if (!pkgJson.scripts?.test && !existsSync(join(targetDir, 'generated.test.js'))) {
    console.log(`\n🧪 No tests found. Asking AI to generate a smoke test for ${targets[0].name}...`);
    const gen = await generateTest(targetDir, targets[0].name);
    if (gen.created) console.log(`   ✓ ${gen.summary}`);
    else console.log(`   ❌ Failed to generate test: ${gen.summary}`);
  }

  const testOpts = { skipLint: args.skipLint, skipSmoke: args.skipSmoke };

  if (!args.skipBaseline) {
    console.log(`\nBaseline: running tests BEFORE upgrades...`);
    const baseline = await runTests(targetDir, pm, targets[0], testOpts);
    report.baseline = baseline;
    if (!baseline.ok && baseline.verified) {
      console.log('   ❌ Baseline tests FAIL. Skipping.');
      report.preExistingFailure = true;
      printReport(report);
      return;
    }
    console.log('   Baseline OK.');
  }

  if (!args.allMajor) {
    Object.assign(report, await processOnePackage(targetDir, pm, git, defaultBranch, targets[0], args));
  } else {
    report.packages = [];
    for (const t of targets) {
      console.log(`\n${'='.repeat(50)}\nProcessing: ${t.name} ${t.current} -> ${t.latest}\n${'='.repeat(50)}`);
      report.packages.push(await processOnePackage(targetDir, pm, git, defaultBranch, t, args));
    }
  }

  if (args.dryRun) console.log('\n[dry-run] skipping commit and PR creation.');

  printReport(report);

  // Generate HTML Report
  const htmlPath = await generateHtmlReport(process.cwd(), report);
  console.log(`\n📊 HTML report generated at: ${htmlPath}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });