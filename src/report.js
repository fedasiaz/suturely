import chalk from 'chalk';
export function printReport(report) {
    console.log('\n' + '='.repeat(60));
    console.log(chalk.bold('REPORT'));
    console.log('='.repeat(60));
    console.log(`Repo:      ${report.repo}`);
    console.log(`Dir:       ${report.dir}`);
    console.log(`PM:        ${report.pm}`);
    if (report.target) {
        console.log(`Upgraded:  ${report.target.name} ${report.target.current} ? ${report.target.latest}`);
    }
    console.log('\nTest attempts:');
    for (const s of report.steps ?? []) {
        const mark = s.ok ? chalk.green('?') : chalk.red('?');
        console.log(`  ${mark} ${s.phase}: ${s.cmd} (exit ${s.exitCode})`);
    }
    console.log('\nFinal: ' + (report.finalOk ? chalk.green('GREEN') : chalk.red('RED')));
    console.log('='.repeat(60) + '\n');
}
