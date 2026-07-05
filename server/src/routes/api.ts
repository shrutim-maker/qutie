import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { db, audit, getSessionState, setSessionState } from '../db.js';
import { parseDocument, parseJiraIssues } from '../services/ingestion.js';
import { generateTestCases, computeCoverage } from '../services/testGenerator.js';
import { executeTestSuite, summarizeResults, checkProductionUrl, normalizeTargetUrl } from '../services/executor.js';
import type { ProgressReporter } from '../services/executor.js';
import {
  initRunProgress,
  getRunProgress,
  appendProgressStep,
  completeRunProgress,
  failRunProgress,
  pruneStaleProgress,
} from '../services/runProgress.js';
import { generateBugReports, deduplicateBugs, computeReadinessScore, computeBugWeight } from '../services/bugs.js';
import { buildJiraPayload, fileBugToJira, fetchJiraIssues, fetchJiraIssuesByKeys, getJiraConfig } from '../services/jira.js';
import {
  fetchConfluencePageById,
  fetchConfluencePageByUrl,
  fetchConfluencePageByTitle,
  ingestConfluencePage,
} from '../services/confluence.js';
import type { Requirement, TestCase, TestResult, BugReport } from '../types.js';

const upload = multer({ storage: multer.memoryStorage() });
export const apiRouter = Router();

const INSTRUCTIONS_KEY = 'instructions';

// In-memory session state for MVP (backed by SQLite for persistence)
let sessionRequirements: Requirement[] = [];
let sessionTestCases: TestCase[] = [];
let sessionResults: TestResult[] = [];
let sessionBugs: BugReport[] = [];
let sessionRuns: Array<Record<string, unknown>> = [];
let sessionInstructions = getSessionState(INSTRUCTIONS_KEY);
const existingBugSignatures = new Set<string>();

const LEGACY_BUNDLED_SOURCE_REFS = new Set([
  'QUTIE_FRD_v1.md',
  'Consolidation_BRD',
  'Business Requirements Document (BRD).docx',
  'HACK-3',
  'HACK-8',
  'qutie-smoke-frd.md',
  'test-upload-brd.md',
]);

function deleteRequirementsByIds(requirementIds: string[]) {
  if (requirementIds.length === 0) return;

  const placeholders = requirementIds.map(() => '?').join(',');
  const testCaseIds = (
    db.prepare(`SELECT id FROM test_cases WHERE requirement_id IN (${placeholders})`).all(...requirementIds) as Array<{
      id: string;
    }>
  ).map((r) => r.id);

  if (testCaseIds.length > 0) {
    const tcPlaceholders = testCaseIds.map(() => '?').join(',');
    const resultIds = (
      db.prepare(`SELECT id FROM results WHERE test_case_id IN (${tcPlaceholders})`).all(...testCaseIds) as Array<{
        id: string;
      }>
    ).map((r) => r.id);

    if (resultIds.length > 0) {
      const resultPlaceholders = resultIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM bugs WHERE result_id IN (${resultPlaceholders})`).run(...resultIds);
      db.prepare(`DELETE FROM results WHERE id IN (${resultPlaceholders})`).run(...resultIds);
    }

    db.prepare(`DELETE FROM test_cases WHERE id IN (${tcPlaceholders})`).run(...testCaseIds);
  }

  db.prepare(`DELETE FROM requirements WHERE id IN (${placeholders})`).run(...requirementIds);
}

function purgeLegacyPasteRequirements() {
  const pasteIds = (
    db.prepare("SELECT id FROM requirements WHERE source_type = 'paste'").all() as Array<{ id: string }>
  ).map((r) => r.id);
  deleteRequirementsByIds(pasteIds);
}

function purgeOrphanedRunData() {
  db.prepare('DELETE FROM bugs').run();
  db.prepare('DELETE FROM results').run();
  db.prepare('DELETE FROM test_runs').run();
  db.prepare('DELETE FROM test_cases WHERE requirement_id NOT IN (SELECT id FROM requirements)').run();
}

function purgeStaleDemoData() {
  purgeLegacyPasteRequirements();
  purgeLegacyBundledRequirements();
  purgeOrphanedRunData();
  sessionRuns = [];
  sessionResults = [];
  sessionBugs = [];
  existingBugSignatures.clear();
}

function purgeLegacyBundledRequirements() {
  const bundledIds = (
    db
      .prepare('SELECT id, source_ref FROM requirements')
      .all() as Array<{ id: string; source_ref: string }>
  )
    .filter((r) => LEGACY_BUNDLED_SOURCE_REFS.has(r.source_ref))
    .map((r) => r.id);
  deleteRequirementsByIds(bundledIds);
}

function syncSessionAfterRequirementDelete() {
  loadTestCasesFromDb();
  const remainingTcIds = new Set(sessionTestCases.map((tc) => tc.id));
  sessionResults = sessionResults.filter((r) => remainingTcIds.has(r.testCaseId));
  sessionBugs = sessionBugs.filter((b) => remainingTcIds.has(b.testCaseId));
}

function requirementsResponse() {
  const bySource = new Map<string, { sourceType: string; sourceRef: string; count: number }>();
  for (const r of sessionRequirements) {
    const key = `${r.sourceType}:${r.sourceRef}`;
    const existing = bySource.get(key);
    if (existing) existing.count++;
    else bySource.set(key, { sourceType: r.sourceType, sourceRef: r.sourceRef, count: 1 });
  }
  return { requirements: sessionRequirements, total: sessionRequirements.length, sources: Array.from(bySource.values()) };
}

function deleteRequirementsBySource(sourceType: string, sourceRef: string) {
  const idsToDelete = sessionRequirements
    .filter((r) => r.sourceType === sourceType && r.sourceRef === sourceRef)
    .map((r) => r.id);
  if (idsToDelete.length === 0) return 0;

  deleteRequirementsByIds(idsToDelete);
  sessionRequirements = sessionRequirements.filter((r) => !(r.sourceType === sourceType && r.sourceRef === sourceRef));
  syncSessionAfterRequirementDelete();
  return idsToDelete.length;
}

function clearAllRequirements() {
  const allIds = (db.prepare('SELECT id FROM requirements').all() as Array<{ id: string }>).map((r) => r.id);
  deleteRequirementsByIds(allIds);
  sessionRequirements = [];
  sessionTestCases = [];
  syncSessionAfterRequirementDelete();
}

function loadRequirementsFromDb() {
  purgeStaleDemoData();

  const rows = db
    .prepare('SELECT id, source_type, source_ref, text, testable, ambiguous FROM requirements')
    .all() as Array<{
    id: string;
    source_type: string;
    source_ref: string;
    text: string;
    testable: number;
    ambiguous: number;
  }>;

  sessionRequirements = rows.map((r) => ({
    id: r.id,
    sourceType: r.source_type as Requirement['sourceType'],
    sourceRef: r.source_ref,
    text: r.text,
    testable: r.testable === 1,
    ambiguous: r.ambiguous === 1,
  }));

  loadTestCasesFromDb();
}

function loadTestCasesFromDb() {
  if (!sessionRequirements.length) {
    sessionTestCases = [];
    return;
  }

  const reqIds = new Set(sessionRequirements.map((r) => r.id));
  const rows = db
    .prepare('SELECT id, requirement_id, title, type, preconditions, steps, test_data, expected_result, status, jira_key FROM test_cases')
    .all() as Array<{
    id: string;
    requirement_id: string;
    title: string;
    type: string;
    preconditions: string;
    steps: string;
    test_data: string;
    expected_result: string;
    status: string;
    jira_key: string | null;
  }>;

  sessionTestCases = rows
    .filter((r) => reqIds.has(r.requirement_id))
    .map((r) => ({
      id: r.id,
      requirementId: r.requirement_id,
      title: r.title,
      type: r.type as TestCase['type'],
      preconditions: r.preconditions,
      steps: JSON.parse(r.steps) as TestCase['steps'],
      testData: r.test_data,
      expectedResult: r.expected_result,
      status: r.status,
      jiraKey: r.jira_key ?? undefined,
    }));
}

loadRequirementsFromDb();

function replaceRequirements(reqs: Requirement[]) {
  clearAllRequirements();
  sessionRequirements = reqs;
  const stmt = db.prepare(
    'INSERT INTO requirements (id, source_type, source_ref, text, testable, ambiguous) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const r of reqs) {
    stmt.run(r.id, r.sourceType, r.sourceRef, r.text, r.testable ? 1 : 0, r.ambiguous ? 1 : 0);
  }
}

function saveTestCases(cases: TestCase[]) {
  sessionTestCases = cases;
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO test_cases (id, requirement_id, title, type, preconditions, steps, test_data, expected_result, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const tc of cases) {
    stmt.run(tc.id, tc.requirementId, tc.title, tc.type, tc.preconditions, JSON.stringify(tc.steps), tc.testData, tc.expectedResult, tc.status);
  }
}

function saveInstructions(text: string) {
  sessionInstructions = text;
  setSessionState(INSTRUCTIONS_KEY, text);
}

function requireRequirements(res: import('express').Response): Requirement[] | null {
  if (!sessionRequirements.length) {
    res.status(400).json({
      error: 'No requirements ingested. Upload an FRD/BRD, fetch from Confluence, or connect Jira first.',
    });
    return null;
  }
  return sessionRequirements;
}

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', product: 'QUTIE', version: '1.0.0-mvp' });
});

apiRouter.get('/instructions', (_req, res) => {
  res.json({ instructions: sessionInstructions });
});

apiRouter.post('/instructions', (req, res) => {
  const { instructions } = req.body;
  if (typeof instructions !== 'string') {
    return res.status(400).json({ error: 'instructions must be a string' });
  }
  saveInstructions(instructions.trim());
  audit('user', 'set_instructions', { length: sessionInstructions.length });
  res.json({ instructions: sessionInstructions });
});

apiRouter.get('/requirements', (_req, res) => {
  res.json(requirementsResponse());
});

apiRouter.delete('/requirements/source', (req, res) => {
  const { sourceType, sourceRef } = req.body ?? {};
  if (typeof sourceType !== 'string' || typeof sourceRef !== 'string' || !sourceType.trim() || !sourceRef.trim()) {
    return res.status(400).json({ error: 'sourceType and sourceRef are required' });
  }

  const removed = deleteRequirementsBySource(sourceType.trim(), sourceRef.trim());
  if (removed === 0) {
    return res.status(404).json({ error: 'No requirements found for that source' });
  }

  audit('user', 'delete_requirements_source', { sourceType, sourceRef, removed });
  res.json({ removed, ...requirementsResponse() });
});

apiRouter.delete('/requirements', (_req, res) => {
  const total = sessionRequirements.length;
  if (total === 0) {
    return res.json({ removed: 0, ...requirementsResponse() });
  }

  clearAllRequirements();
  audit('user', 'clear_requirements', { removed: total });
  res.json({ removed: total, ...requirementsResponse() });
});

apiRouter.post('/ingest/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sourceType = (req.body.sourceType as 'frd' | 'brd') ?? 'frd';
    const parsed = await parseDocument(req.file.buffer, req.file.originalname, sourceType);
    if (!parsed.length) return res.status(400).json({ error: 'No requirements found in uploaded file' });
    replaceRequirements(parsed);
    audit('user', 'ingest_upload', { filename: req.file.originalname, count: parsed.length });
    res.json({ requirements: parsed, total: parsed.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Ingest failed' });
  }
});

apiRouter.post('/ingest/confluence', async (req, res) => {
  try {
    const { pageId, pageUrl, spaceKey, title, baseUrl, email, apiToken } = req.body;
    const overrides = { baseUrl, email, apiToken };

    let page;
    if (pageId) {
      page = await fetchConfluencePageById(String(pageId), overrides);
    } else if (pageUrl) {
      page = await fetchConfluencePageByUrl(String(pageUrl), overrides);
    } else if (spaceKey && title) {
      page = await fetchConfluencePageByTitle(String(spaceKey), String(title), overrides);
    } else {
      return res.status(400).json({
        error: 'Provide pageId, pageUrl, or both spaceKey and title',
      });
    }

    const parsed = ingestConfluencePage(page);
    if (!parsed.length) {
      return res.status(400).json({ error: 'No requirements found in Confluence page content' });
    }

    replaceRequirements(parsed);
    audit('user', 'ingest_confluence', { pageId: page.id, title: page.title, count: parsed.length });
    res.json({ requirements: parsed, total: parsed.length, page: { id: page.id, title: page.title, webUrl: page.webUrl } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Confluence ingest failed';
    const status = message.includes('not configured') ? 400 : message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

apiRouter.post('/ingest/jira', async (req, res) => {
  try {
    const { jql, issueKeys } = req.body;
    let issues: Array<{ key: string; summary: string; description?: string }> = [];

    if (issueKeys?.length) {
      if (!getJiraConfig()) {
        return res.status(400).json({
          error: 'Jira credentials required to fetch issue details. Set JIRA_EMAIL and JIRA_API_TOKEN.',
        });
      }
      issues = await fetchJiraIssuesByKeys(issueKeys);
    } else {
      if (!getJiraConfig() && !jql) {
        return res.status(400).json({
          error: 'Jira is not configured. Set JIRA_EMAIL and JIRA_API_TOKEN, or provide issue keys.',
        });
      }
      issues = await fetchJiraIssues(jql ?? 'ORDER BY created DESC');
    }

    if (!issues.length) {
      return res.status(400).json({
        error: getJiraConfig()
          ? 'No Jira issues matched your query'
          : 'No Jira issues found. Configure Jira credentials or provide issue keys.',
      });
    }

    const parsed = parseJiraIssues(issues);
    replaceRequirements(parsed);
    res.json({ requirements: parsed, total: parsed.length, configured: !!getJiraConfig() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Jira ingest failed' });
  }
});

apiRouter.post('/generate', (req, res) => {
  const reqs = requireRequirements(res);
  if (!reqs) return;

  const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions : sessionInstructions;
  if (typeof req.body?.instructions === 'string') {
    saveInstructions(req.body.instructions.trim());
  }

  const testCases = generateTestCases(reqs, instructions);
  if (!testCases.length) {
    return res.status(400).json({ error: 'No testable requirements found. Check for ambiguous or non-testable items.' });
  }
  saveTestCases(testCases);
  const coverage = computeCoverage(reqs, testCases);

  audit('user', 'generate_tests', { count: testCases.length, coverage: coverage.percentage, hasInstructions: !!instructions });
  res.json({ testCases, coverage, ambiguous: reqs.filter((r) => r.ambiguous), instructions });
});

apiRouter.get('/test-cases', (_req, res) => {
  if (!sessionRequirements.length) {
    return res.json({ testCases: [], coverage: { percentage: 0, total: 0, covered: 0, uncovered: [], ambiguous: [] } });
  }
  const cases = sessionTestCases.length ? sessionTestCases : generateTestCases(sessionRequirements, sessionInstructions);
  const coverage = computeCoverage(sessionRequirements, cases);
  res.json({ testCases: cases, coverage });
});

apiRouter.put('/test-cases/:id', (req, res) => {
  const idx = sessionTestCases.findIndex((tc) => tc.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Test case not found' });
  sessionTestCases[idx] = { ...sessionTestCases[idx], ...req.body };
  saveTestCases(sessionTestCases);
  res.json(sessionTestCases[idx]);
});

apiRouter.delete('/test-cases/:id', (req, res) => {
  sessionTestCases = sessionTestCases.filter((tc) => tc.id !== req.params.id);
  saveTestCases(sessionTestCases);
  res.json({ ok: true });
});

apiRouter.post('/run', async (req, res) => {
  try {
    const { targetUrl, loginUrl, username, password, testCaseIds, retryCount, brokenMode, instructions } = req.body;
    if (!targetUrl) return res.status(400).json({ error: 'targetUrl required' });

    const normalizedUrl = normalizeTargetUrl(targetUrl);
    const prodCheck = checkProductionUrl(normalizedUrl);
    if (prodCheck.blocked) {
      return res.status(403).json({
        error: `Production URL "${prodCheck.hostname}" blocked (FR-17). Dev/staging hosts (e.g. omni-dev.quloi.com) are allowed by default; otherwise set ALLOW_PRODUCTION_URL=true in .env.`,
        code: 'PRODUCTION_URL_BLOCKED',
      });
    }

    const runInstructions = typeof instructions === 'string' ? instructions : sessionInstructions;
    if (typeof instructions === 'string') {
      saveInstructions(instructions.trim());
    }

    const reqs = requireRequirements(res);
    if (!reqs) return;

    const cases = sessionTestCases.length ? sessionTestCases : generateTestCases(reqs, runInstructions);
    if (!cases.length) {
      return res.status(400).json({ error: 'No test cases available. Generate test cases first.' });
    }
    const toRun = testCaseIds?.length ? cases.filter((tc) => testCaseIds.includes(tc.id)) : cases;

    const runId = uuidv4();
    const broken = brokenMode ?? normalizedUrl.includes('broken=1');
    const loginStepEstimate = 4;
    const totalSteps = loginStepEstimate + toRun.reduce((sum, tc) => sum + (tc.steps?.length ?? 1), 0) + toRun.length;

    pruneStaleProgress();
    initRunProgress(runId, totalSteps);

    const progressReporter: ProgressReporter = {
      runId,
      totalSteps,
      onStep: (step) => {
        appendProgressStep(runId, {
          stepIndex: step.stepIndex,
          action: step.action,
          description: step.description,
          screenshotUrl: step.screenshotUrl,
          timestamp: new Date().toISOString(),
          status: step.status,
          testCaseId: step.testCaseId,
          testCaseTitle: step.testCaseTitle,
        });
      },
    };

    res.status(202).json({ runId, status: 'running' });

    void (async () => {
      try {
        const { results, designCompliance, authNote, loginDebug, productionWarning } = await executeTestSuite({
          targetUrl: normalizedUrl,
          loginUrl: typeof loginUrl === 'string' ? loginUrl : undefined,
          username: username ?? '',
          password: password ?? '',
          testCases: toRun,
          retryCount: retryCount ?? 1,
          brokenMode: broken,
          instructions: runInstructions,
          runId,
          verboseEvidence: true,
          progress: progressReporter,
        });

        results.forEach((r) => (r.runId = runId));
        sessionResults = results;

        const summary = summarizeResults(results);
        const bugs = deduplicateBugs(
          generateBugReports(toRun, results, `${targetUrl} · Chromium · buyer role`),
          existingBugSignatures
        );
        sessionBugs = bugs;

        const coverage = computeCoverage(reqs, toRun);
        const bugWeight = computeBugWeight(bugs);
        const readiness = computeReadinessScore({
          passRate: summary.passRate,
          coverage: coverage.percentage,
          designCompliance,
          openBugWeight: bugWeight,
        });

        const run = {
          id: runId,
          targetUrl: normalizedUrl,
          instructions: runInstructions || undefined,
          summary,
          readiness,
          designCompliance,
          coverage,
          bugs,
          results,
          testCases: toRun,
          authNote,
          loginDebug,
          productionWarning: productionWarning ?? prodCheck.warning,
          timestamp: new Date().toISOString(),
        };
        sessionRuns.unshift(run);

        db.prepare(
          'INSERT INTO test_runs (id, target_url, environment, start_time, end_time, summary, readiness_score, readiness_band) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(runId, normalizedUrl, prodCheck.isProduction ? 'production-override' : 'non-prod', new Date().toISOString(), new Date().toISOString(), JSON.stringify(summary), readiness.score, readiness.band);

        audit('user', 'test_run', { runId, summary, readiness: readiness.score, hasInstructions: !!runInstructions });
        completeRunProgress(runId);
      } catch (err) {
        failRunProgress(runId, err instanceof Error ? err.message : 'Run failed');
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Run failed' });
  }
});

apiRouter.get('/run/:runId/progress', (req, res) => {
  const progress = getRunProgress(req.params.runId);
  if (!progress) return res.status(404).json({ error: 'Run not found or expired' });
  res.json(progress);
});

apiRouter.get('/run/:runId', (req, res) => {
  const run = sessionRuns.find((r) => r.id === req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

apiRouter.get('/runs', (_req, res) => {
  res.json({ runs: sessionRuns });
});

apiRouter.get('/runs/latest', (_req, res) => {
  res.json(sessionRuns[0] ?? null);
});

apiRouter.get('/bugs', (_req, res) => {
  res.json({ bugs: sessionBugs });
});

apiRouter.post('/bugs/:id/preview', (req, res) => {
  const bug = sessionBugs.find((b) => b.id === req.params.id);
  if (!bug) return res.status(404).json({ error: 'Bug not found' });
  const payload = buildJiraPayload(bug, `${bug.testCaseId}_failure.png (redacted)`);
  res.json({ payload, bug, duplicate: bug.status === 'duplicate' });
});

apiRouter.post('/bugs/:id/file', async (req, res) => {
  try {
    const bug = sessionBugs.find((b) => b.id === req.params.id);
    if (!bug) return res.status(404).json({ error: 'Bug not found' });

    const { severity, priority } = req.body;
    if (severity) bug.severity = severity;
    if (priority) bug.priority = priority;

    const payload = buildJiraPayload(bug);
    const result = sessionResults.find((r) => r.id === bug.resultId);
    const filed = await fileBugToJira(bug, payload, result?.evidencePath);

    bug.jiraKey = filed.key;
    bug.status = filed.mode === 'linked' ? 'linked' : 'filed';

    const tc = sessionTestCases.find((t) => t.id === bug.testCaseId);
    if (tc) tc.jiraKey = filed.key;

    res.json({ bug, filed, payload });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'File failed' });
  }
});

apiRouter.get('/dashboard', (_req, res) => {
  const latest = sessionRuns[0];
  const trend = sessionRuns.slice(0, 5).reverse().map((r, i) => ({
    label: i === sessionRuns.slice(0, 5).length - 1 ? 'Now' : `Run ${i + 1}`,
    passRate: (r.summary as { passRate: number }).passRate,
    current: i === sessionRuns.slice(0, 5).length - 1,
  }));

  const severityCounts = { Critical: 0, Major: 0, Design: 0, Minor: 0 };
  for (const b of sessionBugs.filter((x) => x.status === 'filed' || x.status === 'pending')) {
    if (b.severityLabel in severityCounts) severityCounts[b.severityLabel as keyof typeof severityCounts]++;
    else severityCounts.Minor++;
  }

  res.json({
    latest: latest ?? null,
    trend,
    severityCounts,
    runs: sessionRuns.length,
  });
});

apiRouter.get('/export/:runId', (req, res) => {
  const run = sessionRuns.find((r) => r.id === req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=qutie-run-${req.params.runId}.json`);
  res.json(run);
});
