import dotenv from 'dotenv';
dotenv.config({ override: true });

import { execa } from 'execa';
import type { SimpleGit } from 'simple-git';
import { cloneRepo } from './clone.js';
import { detectPM, type PM } from './detect.js';
import { getOutdated, pickTarget, pickAllMajor, type OutdatedPkg } from './outdated.js';
import { applyUpgrade } from './upgrade.js';
import { runTests } from './test.js';
import { tryFix } from './fix.js';
import { printReport } from './report.js';
import { createPR, parseGitHubRemote } from './pr.js';

type Args = {
  source: string;
  filterPackage?: string;
  pushPr: boolean;
  dryRun: boolean;
  skipBaseline: boolean;
  skipLint: boolean;
  skipSmoke: boolean;
  allMajor: boolean;
};

function parseArgsOrExit(argv: string[]): Args {
  const out: Args = {
    source: '', pushPr: false, dryRun: false,
    skipBaseline: false, skipLint: false, skipSmoke: false, allMajor: false,
  };
  for (const a of argv) {
    if (a.startsWith('--package=')) out.filterPackage = a.slice('--package='.length);
    else if (a === '--push-pr') out.pushPr = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-baseline') out.skipBaseline = true;
    else if (a === '--skip-lint') out.skipLint = true;
    else if (a === '--no-smoke') out.skipSmoke = true;
    else if (a === '--all-major') out.allMajor = true;
    else if (!a.startsWith('--') && !out.source) out.source = a;
  }
  if (!out.source) {
    console.error('Usage: node dist/index.js <repo-url-or-local-path> [--package=name] [--all-major] [--push-pr] [--dry-run] [--skip-baseline] [--skip-lint] [--no-smoke]');
    process.exit(1);
    throw new Error('unreachable');
  }
  return out;
}

const args: Args = parseArgsOrExit(process.argv.slice(2));

async function pushAndCreatePR(
  dir: string,
  git: SimpleGit,
  branch: string,
  target: OutdatedPkg,
  finalOk: boolean,
  verified: boolean,
): Promise<string | undefined> {
  try {
    await git.addConfig('user.email', 'orch@local');
    await git.addConfig('user.name', 'orchestrator');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '-m', `chore: upgrade ${target.name} ${target.current} → ${target.latest}`], {
      cwd: dir, reject: false,
    });
  } catch (e: any) {
    console.error('   commit failed:', e?.message ?? e);
    return undefined;
  }

  const { stdout: remoteUrl } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: dir, reject: false });
  const parsed = parseGitHubRemote(remoteUrl ?? '');
  if (!parsed) {
    console.error('   cannot parse GitHub remote URL:', remoteUrl);
    return undefined;
  }

  const title = `chore(deps): upgrade ${target.name} ${target.current} → ${target.latest}`;
  const body = [
    `Automated dependency upgrade.`,
    ``,
    `**Package:** \`${target.name}\``,
    `**From:** \`${target.current}\``,
    `**To:** \`${target.latest}\``,
    ``,
    `**Result:** ${verified ? (finalOk ? '✅ GREEN' : '❌ RED') : '⚠️ UNVERIFIED'}`,
  ].join('\n');

  try {
    const pr = await createPR({
      dir, branch, owner: parsed.owner, repo: parsed.repo,
      title, body, token: process.env.GITHUB_TOKEN!,
    });
    console.log(`   PR created: ${pr.url}`);
    return pr.url;
  } catch (e: any) {
    console.error('   PR creation failed:', e?.message ?? e);
    return undefined;
  }
}

async function processOnePackage(
  dir: string,
  pm: PM,
  git: SimpleGit,
  defaultBranch: string,
  target: OutdatedPkg,
  args: Args,
): Promise<any> {
  const rep: any = { target, steps: [] };

  // откат к чистому main перед апгрейдом (кроме первого раза — там уже чистый)
  try {
    await git.checkout(defaultBranch);
    await git.reset(['--hard', `origin/${defaultBranch}`]);
    await execa(pm, ['install', '--no-audit', '--no-fund'], { cwd: dir, reject: false });
  } catch (e: any) {
    console.log('   reset to default failed:', e?.message?.slice(0, 120));
  }

  const safeName = target.name.replace(/[^a-zA-Z0-9-]/g, '-');
  const branch = `orch/upgrade-${safeName}-${Date.now()}`;
  rep.branch = branch;
  await git.checkoutLocalBranch(branch);

  console.log(`⬆️  Upgrading ${target.name}...`);
  await applyUpgrade(dir, pm, target);

  console.log(`🧪 Running tests after upgrade...`);
  const testOpts = { skipLint: args.skipLint, skipSmoke: args.skipSmoke };
  let testResult = await runTests(dir, pm, target, testOpts);
  rep.steps.push({ phase: 'after-upgrade', ...testResult });

  let attempt = 0;
  let lastOutput = testResult.stdout + testResult.stderr;
  while (!testResult.ok && testResult.verified && attempt < 3) {
    attempt++;
    console.log(`🔧 Fix attempt ${attempt}/3...`);
    let fix: { applied: boolean; summary?: string };
    try {
      fix = await tryFix(dir, target, testResult);
    } catch (e: any) {
      fix = { applied: false, summary: 'crash: ' + (e?.message ?? '') };
    }
    if (!fix.applied) {
      console.log('   LLM could not produce a fix:', fix.summary);
      break;
    }
    console.log('   Applied fix:', fix.summary);
    testResult = await runTests(dir, pm, target, testOpts);
    rep.steps.push({ phase: `fix-${attempt}`, ...testResult });
    const nowOutput = testResult.stdout + testResult.stderr;
    if (nowOutput === lastOutput && !testResult.ok) {
      console.log('   Output unchanged — stopping.');
      break;
    }
    lastOutput = nowOutput;
  }

  rep.finalOk = testResult.ok;
  rep.verified = testResult.verified;

  if (!args.dryRun && args.pushPr) {
    const prUrl = await pushAndCreatePR(dir, git, branch, target, testResult.ok, testResult.verified);
    if (prUrl) rep.prUrl = prUrl;
  }

  return rep;
}

async function main() {
  const report: any = {
    repo: args.source,
    skipLint: args.skipLint,
    allMajor: args.allMajor,
  };

  console.log(`\n📦 Preparing source: ${args.source}`);
  const { dir, git, isLocal, defaultBranch } = await cloneRepo(args.source);
  report.dir = dir;
  report.isLocal = isLocal;
  console.log(`   Default branch: ${defaultBranch}`);

  const pm = await detectPM(dir);
  report.pm = pm;
  console.log(`   Package manager: ${pm}`);

  console.log(`\n📥 Installing dependencies...`);
  const installResult = await execa(pm, ['install', '--no-audit', '--no-fund'], { cwd: dir, reject: false });
  if (installResult.exitCode !== 0) {
    console.error('   install failed with exit code', installResult.exitCode);
    console.error(installResult.stderr?.slice(0, 1000));
  }

  console.log(`\n🔍 Checking outdated...`);
  const outdated = await getOutdated(dir, pm);

  let targets: OutdatedPkg[] = [];
  if (args.allMajor) {
    targets = pickAllMajor(outdated);
    if (args.filterPackage) {
      targets = targets.filter((p) => p.name === args.filterPackage);
    }
    console.log(`   Found ${targets.length} major upgrades.`);
  } else {
    const t = pickTarget(outdated, args.filterPackage);
    if (t) targets = [t];
  }

  if (targets.length === 0) {
    console.log('   Nothing to upgrade. Done.');
    return;
  }

  // baseline один раз — на чистом main
  const testOpts = { skipLint: args.skipLint, skipSmoke: args.skipSmoke };
  if (!args.skipBaseline) {
    console.log(`\n🧪 Baseline: running tests BEFORE upgrades...`);
    const baseline = await runTests(dir, pm, targets[0], testOpts);
    report.baseline = baseline;
    if (!baseline.ok && baseline.verified) {
      console.log('   ❌ Baseline tests already FAIL. Skipping everything.');
      console.log('   (pass --skip-baseline to force)');
      report.preExistingFailure = true;
      printReport(report);
      return;
    }
    console.log('   ✓ Baseline OK.');
  }

  if (!args.allMajor) {
    // один пакет — старое поведение
    const rep = await processOnePackage(dir, pm, git, defaultBranch, targets[0], args);
    Object.assign(report, rep);
  } else {
    // цикл по всем мажорным
    report.packages = [];
    for (const t of targets) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing: ${t.name} ${t.current} → ${t.latest}`);
      console.log('='.repeat(50));
      const rep = await processOnePackage(dir, pm, git, defaultBranch, t, args);
      report.packages.push(rep);
    }
  }

  if (args.dryRun) console.log('\n[dry-run] skipping commit and PR creation.');

  printReport(report);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });