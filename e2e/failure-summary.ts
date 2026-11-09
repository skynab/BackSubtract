import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * On GitHub Actions, lists every failed test, with the start of its error, as a few notices
 * on the run's page. Playwright's own "github" reporter details only the first ten failures
 * (GitHub's limit per step), its summary is cut short, and the full log can only be read
 * when signed in to GitHub.
 */

/** GitHub cuts longer annotation messages short. */
const CHUNK = 3500;
/** GitHub shows at most 10 notices per step, and the "github" reporter uses one. */
const MAX_NOTICES = 9;

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
/** Workflow commands need these characters escaped. */
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export default class FailureSummary implements Reporter {
  private failures: string[] = [];
  private total = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.retry === 0) this.total++;
    // Only the last try counts: a test that passes on its retry is flaky, not failed.
    if (result.status === 'passed' || result.status === 'skipped' || result.retry < test.retries) return;
    const project = test.parent.project()?.name ?? '?';
    const file = test.location.file.replace(/\\/g, '/').split('/').pop();
    const error = stripAnsi(result.error?.message ?? result.status)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ')
      .slice(0, 240);
    this.failures.push(`[${project}] ${file}:${test.location.line} ${test.title}\n    ${error}`);
  }

  onEnd(): void {
    if (!process.env.GITHUB_ACTIONS || !this.failures.length) return;
    const chunks: string[] = [];
    for (const line of this.failures) {
      if (!chunks.length || chunks[chunks.length - 1].length + line.length + 1 > CHUNK) chunks.push(line);
      else chunks[chunks.length - 1] += `\n${line}`;
    }
    const shown = chunks.slice(0, MAX_NOTICES);
    shown.forEach((text, i) => {
      const title = `${this.failures.length} of ${this.total} tests failed (${i + 1}/${shown.length})`;
      console.log(`::notice title=${title}::${escapeData(text)}`);
    });
  }

  printsToStdio(): boolean {
    return false;
  }
}
