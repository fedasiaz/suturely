import chalk from 'chalk';

function previewLines(text: string, head = 6, tail = 6): string {
  const lines = String(text).split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= head + tail) return lines.join('\n      ');
  const headPart = lines.slice(0, head);
  const tailPart = lines.slice(-tail);
  return [...headPart, `      ... (${lines.length - head - tail} lines skipped) ...`, ...tailPart].join('\n      ');
}

function verdictOf(r: any): string {
  if (!r.verified) return chalk.yellow('UNVERIFIED');
  if (r.finalOk) return chalk.green('GREEN');
  return chalk.red('RED');
}

function printOnePackage(p: any, idx: number) {
  console.log(`\n${chalk.bold(`[${idx + 1}] ${p.target.name} ${p.target.current} → ${p.target.latest}`)}`);
  if (p.branch) console.log(`    Branch: ${p.branch}`);
  if (p.prUrl) console.log(`    PR:     ${chalk.cyan(p.prUrl)}`);
  if (p.skipped) {
    console.log(`    ${chalk.yellow('SKIPPED')} — baseline failed`);
    return;
  }
  for (const s of p.steps ?? []) {
    const mark = s.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${mark} ${s.phase}: ${s.cmd} (exit ${s.exitCode})`);
    if (s.note) console.log(`        ${chalk.dim(s.note)}`);
    if (s.stdout && !s.ok) console.log(`        ${chalk.dim(previewLines(s.stdout, 3, 3))}`);
  }
  console.log(`    Verdict: ${verdictOf(p)}`);
}

export function printReport(report: any) {
  console.log('\n' + '='.repeat(60));
  console.log(chalk.bold('REPORT'));
  console.log('='.repeat(60));
  console.log(`Repo:      ${report.repo}`);
  console.log(`Dir:       ${report.dir}`);
  console.log(`PM:        ${report.pm}`);
  if (report.isLocal) console.log(`Local:     yes`);
  if (report.skipLint) console.log(`Skip-lint: yes`);
  if (report.allMajor) console.log(`Mode:      --all-major (${report.packages?.length ?? 0} packages)`);

  if (report.baseline) {
    console.log('\nBaseline (before any upgrade):');
    const b = report.baseline;
    const mark = b.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${mark} ${b.cmd} (exit ${b.exitCode})`);
    if (!b.ok) console.log(`      ${chalk.red('PRE-EXISTING FAILURE')}`);
  }

  if (report.packages && report.packages.length > 0) {
    console.log('\n' + '-'.repeat(60));
    report.packages.forEach((p: any, i: number) => printOnePackage(p, i));

    const total = report.packages.length;
    const green = report.packages.filter((p: any) => p.verified && p.finalOk).length;
    const red = report.packages.filter((p: any) => p.verified && !p.finalOk).length;
    const unverified = report.packages.filter((p: any) => !p.verified).length;
    const skipped = report.packages.filter((p: any) => p.skipped).length;

    console.log('\n' + '-'.repeat(60));
    console.log(
      `Totals: ${total} packages — ` +
      `${chalk.green(green + ' GREEN')}, ` +
      `${chalk.red(red + ' RED')}, ` +
      `${chalk.yellow(unverified + ' UNVERIFIED')}, ` +
      `${chalk.yellow(skipped + ' SKIPPED')}`,
    );
    console.log('='.repeat(60) + '\n');
    return;
  }

  if (report.target) {
    console.log(`Upgraded:  ${report.target.name} ${report.target.current} → ${report.target.latest}`);
  }
  if (report.branch) console.log(`Branch:    ${report.branch}`);
  if (report.prUrl) console.log(`PR:        ${chalk.cyan(report.prUrl)}`);

  if (report.preExistingFailure) {
    console.log('\nFinal: ' + chalk.yellow('SKIPPED') + chalk.dim('  (pre-existing test failure)'));
    console.log('='.repeat(60) + '\n');
    return;
  }

  console.log('\nTest attempts:');
  for (const s of report.steps ?? []) {
    const mark = s.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${mark} ${s.phase}: ${s.cmd} (exit ${s.exitCode})`);
    if (s.note) console.log(`      ${chalk.dim(s.note)}`);
    if (s.stdout) console.log(`      ${chalk.dim(previewLines(s.stdout))}`);
  }

  console.log('\nFinal: ' + verdictOf(report));
  console.log('='.repeat(60) + '\n');
}