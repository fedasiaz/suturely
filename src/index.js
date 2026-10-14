import 'dotenv/config';
import { cloneRepo } from './clone.js';
import { detectPM } from './detect.js';
import { getOutdated, pickTarget } from './outdated.js';
import { applyUpgrade } from './upgrade.js';
import { runTests } from './test.js';
import { tryFix } from './fix.js';
import { printReport } from './report.js';
const repoUrl = process.argv[2];
if (!repoUrl) {
    console.error('Usage: node dist/index.js <repo-url>');
    process.exit(1);
}
async function main() {
    const report = { repo: repoUrl, steps: [] };
    console.log(`\n📦 Cloning ${repoUrl}...`);
    const { dir, git } = await cloneRepo(repoUrl);
    report.dir = dir;
    const pm = await detectPM(dir);
    report.pm = pm;
    console.log(`   Package manager: ${pm}`);
    console.log(`\n🔍 Checking outdated...`);
    const outdated = await getOutdated(dir, pm);
    const target = pickTarget(outdated);
    if (!target) {
        console.log('   Nothing to upgrade. Done.');
        return;
    }
    report.target = target;
    console.log(`   Target: ${target.name} ${target.current} → ${target.latest}`);
    console.log(`\n🌿 Creating branch...`);
    await git.checkoutLocalBranch(`orch/upgrade-${target.name}`);
    console.log(`\n⬆️  Upgrading...`);
    await applyUpgrade(dir, pm, target);
    console.log(`\n🧪 Running tests...`);
    let testResult = await runTests(dir, pm);
    report.steps.push({ phase: 'after-upgrade', ...testResult });
    let attempt = 0;
    while (!testResult.ok && attempt < 3) {
        attempt++;
        console.log(`\n🔧 Fix attempt ${attempt}/3...`);
        const fix = await tryFix(dir, target, testResult);
        if (!fix.applied) {
            console.log('   LLM could not produce a fix.');
            break;
        }
        testResult = await runTests(dir, pm);
        report.steps.push({ phase: `fix-${attempt}`, ...testResult });
    }
    report.finalOk = testResult.ok;
    printReport(report);
}
main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
