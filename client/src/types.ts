export interface Requirement {
  id: string;
  sourceType: string;
  sourceRef: string;
  text: string;
  testable: boolean;
  ambiguous: boolean;
  confidence: number;
  rationale: string;
}

export interface TestStep {
  order: number;
  action: string;
  target?: string;
  value?: string;
}

export interface TestCase {
  id: string;
  requirementId: string;
  title: string;
  type: string;
  preconditions: string;
  steps: TestStep[];
  testData: string;
  expectedResult: string;
  status: string;
  jiraKey?: string;
}

export interface Coverage {
  percentage: number;
  total: number;
  covered: number;
  uncovered: Array<{ id: string; text: string }>;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  flaky: number;
  passRate: number;
}

export interface StepEvidence {
  stepIndex: number;
  action: string;
  screenshotUrl: string;
  timestamp: string;
  status: 'pass' | 'fail' | 'running';
  description?: string;
}

export interface TestResult {
  id: string;
  testCaseId: string;
  runId: string;
  status: 'pass' | 'fail' | 'blocked' | 'skipped' | 'flaky';
  actualResult?: string;
  failingStep?: number;
  evidencePath?: string;
  stepEvidence?: StepEvidence[];
}

export interface ProgressStep {
  stepIndex: number;
  action: string;
  description: string;
  screenshotUrl?: string;
  timestamp: string;
  status: 'running' | 'complete' | 'fail';
  testCaseId?: string;
  testCaseTitle?: string;
}

export interface RunProgress {
  runId: string;
  status: 'running' | 'complete' | 'error';
  currentStep: string;
  currentTestCaseId?: string;
  currentTestCaseTitle?: string;
  completed: number;
  total: number;
  steps: ProgressStep[];
  latestScreenshotUrl?: string;
  error?: string;
}

export interface BugReport {
  id: string;
  resultId: string;
  title: string;
  severity: 'functional' | 'data' | 'blocking' | 'cosmetic' | 'design';
  severityLabel: string;
  priority: string;
  reportBody: string;
  jiraKey?: string;
  status: string;
  signature: string;
  testCaseId: string;
  requirementId: string;
  expected?: string;
  actual?: string;
  evidenceUrl?: string;
  /** Seeded via /api/bugs/demo for presentations — never filed to real Jira. */
  isDemo?: boolean;
}

export interface TestRun {
  id: string;
  targetUrl: string;
  summary: RunSummary;
  readiness: { score: number; band: string; inputs: Record<string, number> };
  designCompliance: number;
  coverage: Coverage;
  bugs: BugReport[];
  results: TestResult[];
  testCases: TestCase[];
  authNote?: string;
  loginDebug?: string[];
  productionWarning?: string;
  timestamp: string;
  instructions?: string;
}

export interface JiraPayload {
  project: { key: string };
  issuetype: string;
  summary: string;
  priority: string;
  labels: string[];
  description: string;
  customfield_req: string;
  attachments: string[];
}
