import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function generateHtmlReport(dir: string, report: any): Promise<string> {
  const statusColor = report.preExistingFailure ? '#f59e0b' : report.finalOk ? '#10b981' : '#ef4444';
  const statusText = report.preExistingFailure ? 'SKIPPED (Pre-existing Failure)' : report.finalOk ? 'GREEN (Success)' : 'RED (Failed)';

  let packagesHtml = '';
  if (report.packages && report.packages.length > 0) {
    for (const p of report.packages) {
      packagesHtml += `
        <div class="card">
          <h3>${p.target.name} <span>${p.target.current} → ${p.target.latest}</span></h3>
          <p>Status: <strong>${p.finalOk ? '✅ GREEN' : '❌ RED'}</strong></p>
          ${p.prUrl ? `<p><a href="${p.prUrl}" target="_blank">View Pull Request</a></p>` : ''}
        </div>
      `;
    }
  } else if (report.target) {
    packagesHtml = `
      <div class="card">
        <h3>${report.target.name} <span>${report.target.current} → ${report.target.latest}</span></h3>
        <p>Status: <strong>${report.finalOk ? '✅ GREEN' : '❌ RED'}</strong></p>
        ${report.prUrl ? `<p><a href="${report.prUrl}" target="_blank">View Pull Request</a></p>` : ''}
      </div>
    `;
  }

  let stepsHtml = '';
  if (report.steps) {
    for (const s of report.steps) {
      stepsHtml += `
        <div class="step ${s.ok ? 'ok' : 'fail'}">
          <h4>${s.phase} (${s.cmd})</h4>
          <pre>${s.stdout || s.stderr || 'No output'}</pre>
        </div>
      `;
    }
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>suturely report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #fff; border-bottom: 1px solid #30363d; padding-bottom: 10px; display: flex; align-items: center; gap: 10px; }
    h1 svg { width: 28px; height: 28px; fill: #fff; }
    .status { display: inline-block; padding: 8px 16px; border-radius: 6px; font-weight: bold; color: #000; background: ${statusColor}; margin-bottom: 20px; }
    .meta { color: #8b949e; font-size: 14px; margin-bottom: 30px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 20px; margin-bottom: 20px; }
    .card h3 { margin-top: 0; color: #fff; }
    .card h3 span { color: #58a6ff; font-size: 16px; }
    .card a { color: #58a6ff; text-decoration: none; }
    .card a:hover { text-decoration: underline; }
    .step { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 15px; margin-bottom: 15px; }
    .step.ok { border-left: 4px solid #10b981; }
    .step.fail { border-left: 4px solid #ef4444; }
    .step h4 { margin-top: 0; color: #8b949e; font-size: 14px; }
    pre { background: #161b22; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 13px; color: #c9d1d9; }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
      </svg>
      suturely Report
    </h1>
    <div class="status">${statusText}</div>
    <div class="meta">
      <p><strong>Repo:</strong> ${report.repo}</p>
      <p><strong>Package Manager:</strong> ${report.pm}</p>
      <p><strong>Mode:</strong> ${report.allMajor ? 'All Major' : 'Single Package'}</p>
    </div>

    <h2>📦 Packages</h2>
    ${packagesHtml || '<p>No packages upgraded.</p>'}

    <h2>🧪 Execution Steps</h2>
    ${stepsHtml || '<p>No steps recorded.</p>'}
  </div>
</body>
</html>
  `;

  const reportPath = join(dir, 'suturely-report.html');
  await writeFile(reportPath, html, 'utf8');
  return reportPath;
}