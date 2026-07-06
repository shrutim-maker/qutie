import type { TestCase, TestResult, BugReport } from '../types.js';

const SEVERITY_MAP: Record<string, { label: string; jira: string }> = {
  functional: { label: 'Critical', jira: 'Critical' },
  blocking: { label: 'Critical', jira: 'Blocker' },
  data: { label: 'Major', jira: 'Major' },
  cosmetic: { label: 'Minor', jira: 'Minor' },
  design: { label: 'Design', jira: 'Minor' },
};

function inferSeverity(tc: TestCase, result: TestResult): BugReport['severity'] {
  if (tc.type === 'Design') return 'design';
  if (tc.title.toLowerCase().includes('booking') && result.status === 'fail') return 'blocking';
  if (tc.type === 'Negative' && result.status === 'fail') return 'functional';
  if (tc.type === 'Edge') return 'data';
  return 'functional';
}

/** FR-28/FR-29: priority from severity + flow criticality + reproducibility, mapped to the full Jira scale. */
function computePriority(severity: BugReport['severity'], _requirementId: string, reproducible: boolean): string {
  const flowWeight = 5;
  let score = flowWeight;
  if (severity === 'blocking') score += 8;
  else if (severity === 'functional') score += 5;
  else if (severity === 'data') score += 4;
  if (severity === 'design') score += 1;
  if (!reproducible) score -= 2;

  if (score >= 13) return 'Blocker';
  if (score >= 10) return 'Critical';
  if (score >= 8) return 'Major';
  if (score >= 6) return 'Minor';
  return 'Trivial';
}

function buildSignature(tc: TestCase, result: TestResult): string {
  return `${tc.requirementId}:${result.failingStep ?? 0}:${tc.title.slice(0, 40)}`;
}

export function generateBugReports(
  testCases: TestCase[],
  results: TestResult[],
  environment: string
): BugReport[] {
  const bugs: BugReport[] = [];
  const tcMap = new Map(testCases.map((tc) => [tc.id, tc]));

  for (const result of results.filter((r) => r.status === 'fail')) {
    const tc = tcMap.get(result.testCaseId);
    if (!tc) continue;

    const severity = inferSeverity(tc, result);
    const severityInfo = SEVERITY_MAP[severity];
    const priority = computePriority(severity, tc.requirementId, true);
    const signature = buildSignature(tc, result);

    const failEvidence = result.stepEvidence?.filter((ev) => ev.status === 'fail');
    bugs.push({
      id: `bug-${result.id}`,
      resultId: result.id,
      title: tc.title.includes('Verify') ? `Failure: ${tc.title.slice(0, 60)}` : tc.title,
      severity,
      severityLabel: severityInfo.label,
      priority,
      reportBody: buildReportBody(tc, result, environment),
      status: 'pending',
      signature,
      testCaseId: tc.id,
      requirementId: tc.requirementId,
      expected: tc.expectedResult,
      actual: result.actualResult,
      evidenceUrl:
        result.evidenceUrl ??
        failEvidence?.[failEvidence.length - 1]?.screenshotUrl ??
        result.stepEvidence?.[result.stepEvidence.length - 1]?.screenshotUrl,
    });
  }

  return bugs;
}

/**
 * Seeds one clearly-fake bug for live demos/presentations — no real test run behind it.
 * isDemo: true is a hard safety rail (see routes/api.ts POST /bugs/:id/file) so this can
 * never actually create a real Jira issue, even if someone clicks "file" on it.
 */
export function createDemoBug(): BugReport {
  return {
    id: 'bug-demo',
    resultId: 'demo-result',
    title: '[DEMO] Booking form accepts an empty destination field',
    severity: 'blocking',
    severityLabel: 'Critical',
    priority: 'Blocker',
    reportBody: [
      '*[DEMO BUG — sample data for presentation purposes only, not a real finding]*',
      '',
      '*Steps to reproduce:*',
      '1. navigate /consolidation',
      '2. click button:has-text("Create Booking")',
      '3. click button:has-text("Submit") (destination field left empty)',
      '',
      '*Expected:* Booking submission is rejected when the destination field is empty, with a clear validation error shown to the user.',
      '*Actual:* The booking was accepted with an empty destination field. No validation error appeared and the shipment proceeded without a destination.',
      '*Environment:* [DEMO] · Chromium · buyer role',
      '*Requirement:* FR-DEMO',
      '*Failing step:* 3',
    ].join('\n'),
    status: 'pending',
    signature: 'demo-signature-never-filed',
    testCaseId: 'TC-DEMO',
    requirementId: 'FR-DEMO',
    expected: 'Booking submission is rejected when the destination field is empty, with a clear validation error shown to the user.',
    actual: 'The booking was accepted with an empty destination field. No validation error appeared and the shipment proceeded without a destination.',
    isDemo: true,
  };
}

function buildReportBody(tc: TestCase, result: TestResult, environment: string): string {
  const steps = tc.steps.map((s) => `${s.order}. ${s.action} ${s.target ?? ''} ${s.value ?? ''}`).join('\n');
  return [
    `*Steps to reproduce:*`,
    steps,
    ``,
    `*Expected:* ${tc.expectedResult}`,
    `*Actual:* ${result.actualResult}`,
    `*Environment:* ${environment}`,
    `*Requirement:* ${tc.requirementId}`,
    `*Failing step:* ${result.failingStep ?? 'unknown'}`,
  ].join('\n');
}

/**
 * FR-24: mark a bug as a duplicate only when a matching bug was already filed to Jira,
 * carrying the real issue key so QUTIE can link/comment instead of re-creating.
 */
export function deduplicateBugs(bugs: BugReport[], filedSignatures: Map<string, string>): BugReport[] {
  return bugs.map((bug) => {
    const existingKey = filedSignatures.get(bug.signature);
    if (existingKey) {
      return { ...bug, status: 'duplicate', jiraKey: existingKey };
    }
    return bug;
  });
}

export interface ReadinessInputs {
  passRate: number;
  coverage: number;
  designCompliance: number;
  openBugWeight: number;
}

export function computeReadinessScore(inputs: ReadinessInputs): {
  score: number;
  band: 'go' | 'caution' | 'no-go';
  inputs: ReadinessInputs;
} {
  const weights = { passRate: 0.35, coverage: 0.25, designCompliance: 0.15, openBugWeight: 0.25 };
  const bugScore = Math.max(0, 100 - inputs.openBugWeight);
  const score = Math.round(
    inputs.passRate * weights.passRate +
      inputs.coverage * weights.coverage +
      inputs.designCompliance * weights.designCompliance +
      bugScore * weights.openBugWeight
  );

  let band: 'go' | 'caution' | 'no-go' = 'caution';
  if (score >= 75) band = 'go';
  else if (score < 50) band = 'no-go';

  return { score, band, inputs };
}

export function computeBugWeight(bugs: BugReport[]): number {
  let weight = 0;
  for (const b of bugs.filter((x) => x.status !== 'duplicate')) {
    if (b.priority === 'Blocker') weight += 45;
    else if (b.priority === 'Critical') weight += 35;
    else if (b.priority === 'Major') weight += 20;
    else if (b.severity === 'design') weight += 10;
    else weight += 5;
  }
  return Math.min(weight, 100);
}
