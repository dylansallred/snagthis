import { classifyProblem } from '@m3u8/contracts/src/rows.mjs';
import { ui } from './strings';

// Build from an allowlist, never by serializing the diagnostics response: even a
// redacted response can contain media hosts or paths that do not belong in an issue URL.
export function buildSiteReportUrl(diagnostics: Record<string, unknown> | null, version?: string) {
  const statuses = ['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled'];
  const summary: Record<string, number> = {};
  const problems: Record<string, number> = {};
  const jobs = Array.isArray(diagnostics?.jobs) ? diagnostics.jobs : [];
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const status = statuses.includes(job.status) ? job.status : 'unknown';
    summary[status] = (summary[status] || 0) + 1;
    if (status === 'failed') {
      const category = classifyProblem(job.error).code;
      problems[category] = (problems[category] || 0) + 1;
    }
  }
  const safeVersion = typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version) ? version : 'development';
  const safeSummary = { appVersion: safeVersion, downloadsByStatus: summary, problemsByCategory: problems };
  const stages = [ui.reportStagePage, ui.reportStageDetection, ui.reportStageRow, ui.reportStageQuality, ui.reportStageFetch, ui.reportStageDownload, ui.reportStagePlayback];
  const body = [
    ui.reportInstructions, '',
    `### ${ui.reportSummary}`, '```json', JSON.stringify(safeSummary, null, 2), '```', '',
    `### ${ui.reportStages}`,
    ...stages.map((stage, index) => `- S${index + 1} ${stage}: ${ui.reportNotChecked}`),
  ].join('\n');
  const url = new URL('https://github.com/dylansallred/snagthis/issues/new');
  url.searchParams.set('title', ui.reportTitle);
  url.searchParams.set('body', body);
  return url.href;
}
