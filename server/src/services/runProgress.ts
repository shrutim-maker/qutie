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
  startedAt: string;
  updatedAt: string;
}

const progressStore = new Map<string, RunProgress>();

export function initRunProgress(runId: string, total: number): RunProgress {
  const progress: RunProgress = {
    runId,
    status: 'running',
    currentStep: 'Starting test run...',
    completed: 0,
    total,
    steps: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  progressStore.set(runId, progress);
  return progress;
}

export function getRunProgress(runId: string): RunProgress | undefined {
  return progressStore.get(runId);
}

export function appendProgressStep(runId: string, step: ProgressStep): void {
  const progress = progressStore.get(runId);
  if (!progress) return;
  progress.steps.push(step);
  if (progress.steps.length > 80) {
    progress.steps = progress.steps.slice(-80);
  }
  progress.currentStep = step.description;
  progress.currentTestCaseId = step.testCaseId;
  progress.currentTestCaseTitle = step.testCaseTitle;
  if (step.screenshotUrl) progress.latestScreenshotUrl = step.screenshotUrl;
  if (step.status === 'complete' || step.status === 'fail') {
    progress.completed = Math.min(progress.completed + 1, progress.total);
  }
  progress.updatedAt = new Date().toISOString();
}

export function updateProgressMeta(
  runId: string,
  patch: Partial<Pick<RunProgress, 'currentStep' | 'completed' | 'total' | 'latestScreenshotUrl'>>
): void {
  const progress = progressStore.get(runId);
  if (!progress) return;
  Object.assign(progress, patch);
  progress.updatedAt = new Date().toISOString();
}

export function completeRunProgress(runId: string): void {
  const progress = progressStore.get(runId);
  if (!progress) return;
  progress.status = 'complete';
  progress.completed = progress.total;
  progress.currentStep = 'Run complete';
  progress.updatedAt = new Date().toISOString();
}

export function failRunProgress(runId: string, error: string): void {
  const progress = progressStore.get(runId);
  if (!progress) return;
  progress.status = 'error';
  progress.error = error;
  progress.currentStep = `Run failed: ${error}`;
  progress.updatedAt = new Date().toISOString();
}

/** Prune progress entries older than 2 hours to avoid memory leaks. */
export function pruneStaleProgress(): void {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, p] of progressStore) {
    if (new Date(p.updatedAt).getTime() < cutoff) progressStore.delete(id);
  }
}
