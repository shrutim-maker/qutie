export interface Requirement {
  id: string;
  sourceType: 'frd' | 'brd' | 'jira' | 'confluence';
  sourceRef: string;
  text: string;
  testable: boolean;
  ambiguous: boolean;
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
  type: 'Positive' | 'Negative' | 'Edge' | 'Design';
  preconditions: string;
  steps: TestStep[];
  testData: string;
  expectedResult: string;
  status: string;
  jiraKey?: string;
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
  evidenceUrl?: string;
  stepEvidence?: StepEvidence[];
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

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  flaky: number;
  passRate: number;
}

export interface ReadinessScore {
  score: number;
  band: 'go' | 'caution' | 'no-go';
  inputs: {
    passRate: number;
    coverage: number;
    designCompliance: number;
    openBugWeight: number;
  };
}

export interface Coverage {
  percentage: number;
  total: number;
  covered: number;
  uncovered: Array<{ id: string; text: string }>;
}

export interface TestRun {
  id: string;
  targetUrl: string;
  summary: RunSummary;
  readiness: ReadinessScore;
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
