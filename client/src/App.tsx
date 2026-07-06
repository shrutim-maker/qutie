import { useCallback, useEffect, useRef, useState, Fragment } from 'react';
import { api, type RequirementSource } from './api';
import { QutieMark } from './components/QutieMark';
import type { BugReport, Coverage, ProgressStep, RunProgress, TestCase, TestResult, TestRun } from './types';

type View = 'run' | 'cases' | 'results' | 'bugs' | 'dash';

const TITLES: Record<View, [string, string]> = {
  run: ['New Run', 'Point QUTIE at a build and let it test against your specs'],
  cases: ['Test Cases', 'Generated from your specs, editable before you run'],
  results: ['Results', 'Pass, fail, blocked and flaky with evidence'],
  bugs: ['Bugs', 'Prioritised and prepped for Jira, filed only on your confirm'],
  dash: ['Dashboard', 'Coverage, readiness and trend at a glance'],
};

const BADGE: Record<string, [string, string]> = {
  pass: ['b-pass', 'Pass'],
  fail: ['b-fail', 'Fail'],
  blocked: ['b-block', 'Blocked'],
  flaky: ['b-flaky', 'Flaky'],
};

function StatusBadge({ status }: { status: string }) {
  const [cls, label] = BADGE[status] ?? ['b-pending', status];
  return <span className={`badge ${cls}`}><span className="d" />{label}</span>;
}

export default function App() {
  const [view, setView] = useState<View>('run');
  const [targetUrl, setTargetUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [genStatus, setGenStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [runProgress, setRunProgress] = useState(0);
  const [runLabel, setRunLabel] = useState('Ready to run');
  const [runError, setRunError] = useState('');
  const [running, setRunning] = useState(false);
  const [liveProgress, setLiveProgress] = useState<RunProgress | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [latestRun, setLatestRun] = useState<TestRun | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPayload, setModalPayload] = useState('');
  const [activeBug, setActiveBug] = useState<BugReport | null>(null);
  const [dashboard, setDashboard] = useState<{ trend: Array<{ label: string; passRate: number; current?: boolean }>; severityCounts: Record<string, number>; runs: number } | null>(null);
  const [gaugeScore, setGaugeScore] = useState(0);
  const frdInputRef = useRef<HTMLInputElement>(null);
  const brdInputRef = useRef<HTMLInputElement>(null);
  const [reqCount, setReqCount] = useState(0);
  const [sources, setSources] = useState<RequirementSource[]>([]);
  const [instructions, setInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [confluenceOpen, setConfluenceOpen] = useState(false);
  const [confluenceMode, setConfluenceMode] = useState<'pageId' | 'pageUrl' | 'search'>('pageUrl');
  const [confluencePageId, setConfluencePageId] = useState('');
  const [confluencePageUrl, setConfluencePageUrl] = useState('');
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState('');
  const [confluenceTitle, setConfluenceTitle] = useState('');
  const [confluenceBaseUrl, setConfluenceBaseUrl] = useState('');
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraQuery, setJiraQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteSourceType, setPasteSourceType] = useState<'frd' | 'brd'>('frd');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());
  const [priorityOverride, setPriorityOverride] = useState('');
  const [filing, setFiling] = useState(false);

  const refreshRequirements = useCallback(async () => {
    try {
      const data = await api.getRequirements();
      setReqCount(data.total);
      setSources(data.sources);
    } catch {
      setReqCount(0);
      setSources([]);
    }
  }, []);

  const refreshTestCases = useCallback(async () => {
    try {
      const data = await api.getTestCases();
      if (data.testCases.length) {
        setTestCases(data.testCases);
        setCoverage(data.coverage);
      }
    } catch {
      /* server may have no requirements yet */
    }
  }, []);

  useEffect(() => {
    refreshRequirements();
    refreshTestCases();
    api.getInstructions().then((d) => setInstructions(d.instructions)).catch(() => {});
    api.health().then((d) => setAiEnabled(!!d.aiGeneration)).catch(() => {});
    // Restore the latest run so Results/Bugs survive a page refresh
    fetch('/api/runs/latest')
      .then((r) => r.json())
      .then((run: TestRun | null) => {
        if (run && run.id) {
          setLatestRun(run);
          setResults(run.results ?? []);
          setBugs(run.bugs ?? []);
          setRunLabel('Run complete');
          setRunProgress(100);
        }
      })
      .catch(() => {});
  }, [refreshRequirements, refreshTestCases]);

  const go = useCallback((v: View) => {
    setView(v);
    if (v === 'dash') loadDashboard();
    if (v === 'bugs') api.getBugs().then((d) => setBugs(d.bugs)).catch(() => {});
  }, []);

  const loadDashboard = async () => {
    const d = await api.getDashboard();
    setDashboard(d);
    if (d.latest) {
      setLatestRun(d.latest);
      animateGauge(d.latest.readiness.score);
    }
  };

  const animateGauge = (score: number) => {
    let n = 0;
    const iv = setInterval(() => {
      n += 2;
      if (n >= score) { n = score; clearInterval(iv); }
      setGaugeScore(n);
    }, 22);
  };

  const saveInstructions = async (text: string) => {
    try {
      await api.setInstructions(text);
      setInstructionsSaved(true);
      setTimeout(() => setInstructionsSaved(false), 2000);
    } catch {
      /* ignore transient save errors */
    }
  };

  const handleInstructionsChange = (text: string) => {
    setInstructions(text);
    void saveInstructions(text);
  };

  const clearRelatedTestState = useCallback(() => {
    setTestCases([]);
    setCoverage(null);
    setGenStatus('');
  }, []);

  const handleRemoveSource = async (source: RequirementSource) => {
    const label = `${source.sourceRef} (${source.sourceType.toUpperCase()})`;
    if (!window.confirm(`Remove "${label}" and its ${source.count} requirement${source.count === 1 ? '' : 's'}? Related test cases will also be removed.`)) {
      return;
    }
    try {
      const data = await api.deleteRequirementSource(source.sourceType, source.sourceRef);
      setReqCount(data.total);
      setSources(data.sources);
      clearRelatedTestState();
      setGenStatus(data.total === 0 ? '' : `Removed ${source.sourceRef} — ${data.total} requirements remaining`);
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const handleClearAllRequirements = async () => {
    if (!window.confirm(`Remove all ${reqCount} requirements and related test cases?`)) {
      return;
    }
    try {
      const data = await api.clearRequirements();
      setReqCount(data.total);
      setSources(data.sources);
      clearRelatedTestState();
      setGenStatus('');
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Clear failed');
    }
  };

  const sourceIcon = (sourceType: string) => {
    if (sourceType === 'jira') return '✓';
    if (sourceType === 'confluence') return '☁';
    return '📄';
  };

  const handleGenerate = async () => {
    if (reqCount === 0) {
      setGenStatus('Add requirements first — upload FRD/BRD, fetch from Confluence, or connect Jira.');
      return;
    }
    setGenerating(true);
    setGenStatus(
      aiEnabled
        ? targetUrl.trim()
          ? 'Claude is scouting your app and writing test cases (may take a minute)...'
          : 'Claude is writing test cases from your requirements (may take a minute)...'
        : 'Extracting testable requirements...'
    );
    try {
      const data = await api.generate({
        instructions,
        targetUrl: targetUrl.trim() || undefined,
        loginUrl: loginUrl.trim() || undefined,
        username: username || undefined,
        password: password || undefined,
      });
      setGenStatus('Mapping tests to requirements...');
      await new Promise((r) => setTimeout(r, 300));
      setTestCases(data.testCases);
      setCoverage(data.coverage);
      const via = data.generator === 'ai' ? ' · AI-generated by Claude' : '';
      const note = data.generatorNote ? ` — ${data.generatorNote}` : '';
      setGenStatus(`${data.testCases.length} test cases ready across ${data.coverage.total} requirements.${via}${note}`);
      go('cases');
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleRun = async () => {
    if (!targetUrl.trim()) {
      setRunLabel('Enter a product URL before running');
      setRunError('');
      return;
    }
    if (reqCount === 0) {
      setRunLabel('Add requirements before running');
      setRunError('Upload FRD/BRD, fetch from Confluence, or connect Jira first.');
      return;
    }

    let casesToRun = testCases;
    if (!casesToRun.length) {
      try {
        const data = await api.getTestCases();
        casesToRun = data.testCases;
        if (casesToRun.length) {
          setTestCases(casesToRun);
          setCoverage(data.coverage);
        }
      } catch {
        /* fall through */
      }
    }
    if (!casesToRun.length) {
      setRunLabel('Generate test cases before running');
      setRunError('No test cases found — click Generate test cases on the New Run tab.');
      return;
    }

    setRunning(true);
    setRunProgress(0);
    setRunError('');
    setRunLabel('Starting test run...');
    setResults([]);
    setLatestRun(null);
    setLiveProgress(null);
    setExpandedResults(new Set());
    go('results');

    try {
      const { runId } = await api.run({
        targetUrl,
        loginUrl: loginUrl.trim() || undefined,
        username,
        password,
        instructions,
      });

      const pollProgress = async (): Promise<TestRun | null> => {
        const progress = await api.getRunProgress(runId);
        setLiveProgress(progress);
        setRunLabel(progress.currentStep);
        const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
        setRunProgress(Math.min(pct, 99));

        if (progress.status === 'complete') {
          return await api.getRun(runId);
        }
        if (progress.status === 'error') {
          throw new Error(progress.error ?? 'Run failed');
        }
        return null;
      };

      let run: TestRun | null = null;
      while (!run) {
        run = await pollProgress();
        if (!run) await new Promise((r) => setTimeout(r, 500));
      }

      setRunProgress(100);
      setRunLabel(run.productionWarning ? `Run complete — ${run.productionWarning}` : 'Run complete');
      setLatestRun(run);
      setResults(run.results);
      setBugs(run.bugs);
      setCoverage(run.coverage);
      if (run.testCases?.length) {
        setTestCases(run.testCases);
      }
      if (run.authNote) {
        const isFailure =
          run.authNote.includes('failed') ||
          run.authNote.includes('Could not') ||
          run.authNote.includes('No login form') ||
          run.authNote.includes('read-only') ||
          run.authNote.includes('SSO') ||
          run.authNote.includes('not found') ||
          run.authNote.includes('crashed');
        setRunError(isFailure ? run.authNote : '');
      }
      setRunning(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Run failed';
      setRunLabel('Run failed');
      setRunError(msg);
      setRunning(false);
    }
  };

  const toggleResultExpand = (resultId: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, sourceType: 'frd' | 'brd') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await api.ingestUpload(file, sourceType);
      await refreshRequirements();
      setGenStatus(`Ingested ${file.name} — ${data.total} requirements total`);
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Upload failed');
    }
    e.target.value = '';
  };

  const handleConfluenceIngest = async () => {
    try {
      const body =
        confluenceMode === 'pageId'
          ? { pageId: confluencePageId, baseUrl: confluenceBaseUrl || undefined }
          : confluenceMode === 'pageUrl'
            ? { pageUrl: confluencePageUrl, baseUrl: confluenceBaseUrl || undefined }
            : {
                spaceKey: confluenceSpaceKey,
                title: confluenceTitle,
                baseUrl: confluenceBaseUrl || undefined,
              };
      const data = await api.ingestConfluence(body);
      await refreshRequirements();
      setGenStatus(`Ingested Confluence page "${data.page.title}" — ${data.total} requirements total`);
      setConfluenceOpen(false);
      setConfluencePageId('');
      setConfluencePageUrl('');
      setConfluenceSpaceKey('');
      setConfluenceTitle('');
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Confluence ingest failed');
    }
  };

  const handlePasteIngest = async () => {
    try {
      const data = await api.ingestPaste(pasteText, pasteSourceType);
      await refreshRequirements();
      setGenStatus(`Ingested pasted ${pasteSourceType.toUpperCase()} — ${data.total} requirements total`);
      setPasteOpen(false);
      setPasteText('');
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Paste ingest failed');
    }
  };

  const handleJiraIngest = async () => {
    try {
      const data = await api.ingestJira(jiraQuery || undefined);
      await refreshRequirements();
      setGenStatus(`Ingested Jira issues — ${data.total} requirements total`);
      setJiraOpen(false);
      setJiraQuery('');
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Jira ingest failed');
    }
  };

  const openBugModal = async (bug: BugReport) => {
    setActiveBug(bug);
    setPriorityOverride(bug.priority);
    const preview = await api.previewBug(bug.id);
    const p = preview.payload;
    setModalPayload(
      `POST /rest/api/3/issue\n` +
      JSON.stringify(p, null, 2) +
      (preview.duplicate ? '\n\n// Similar open issue detected. QUTIE will comment + link instead of creating a duplicate.' : '') +
      (bug.isDemo ? '\n\n// DEMO BUG — sample data for presentation only. Confirming here will NOT write to real Jira.' : '')
    );
    setModalOpen(true);
  };

  const handleSeedDemoBug = async () => {
    try {
      const { bug } = await api.seedDemoBug();
      setBugs((prev) => (prev.some((b) => b.id === bug.id) ? prev : [bug, ...prev]));
      go('bugs');
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Could not add demo bug');
    }
  };

  const handleRemoveDemoBug = async (id: string) => {
    try {
      await api.deleteBug(id);
      setBugs((prev) => prev.filter((b) => b.id !== id));
    } catch {
      /* best-effort */
    }
  };

  const confirmFile = async () => {
    if (!activeBug || filing) return;
    setFiling(true);
    try {
      const overrides = priorityOverride && priorityOverride !== activeBug.priority ? { priority: priorityOverride } : {};
      const res = await api.fileBug(activeBug.id, overrides);
      setBugs((prev) => prev.map((b) => (b.id === activeBug.id ? { ...b, ...res.bug } : b)));
      setModalOpen(false);
    } catch (err) {
      setModalPayload((p) => `${p}\n\n// Filing failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setFiling(false);
    }
  };

  const toggleCaseExpand = (id: string) => {
    setExpandedCases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteCase = async (tc: TestCase) => {
    if (!window.confirm(`Remove ${tc.id} — "${tc.title}"? It will be excluded from the next run.`)) return;
    try {
      await api.deleteTestCase(tc.id);
      const data = await api.getTestCases();
      setTestCases(data.testCases);
      setCoverage(data.coverage);
    } catch (err) {
      setGenStatus(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const tcMap = new Map(testCases.map((tc) => [tc.id, tc]));
  const hasRequirements = reqCount > 0;
  const hasRuns = (dashboard?.runs ?? 0) > 0 || latestRun !== null;

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-logo"><QutieMark size={44} /></div>
        <nav className="rail-nav">
          {(['run', 'cases', 'results', 'bugs', 'dash'] as View[]).map((v) => (
            <button key={v} className={`rail-btn ${view === v ? 'active' : ''}`} onClick={() => go(v)}>
              <NavIcon view={v} />
              <span>{v === 'run' ? 'New Run' : v === 'cases' ? 'Cases' : v === 'results' ? 'Results' : v === 'bugs' ? 'Bugs' : 'Dashboard'}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot"><div className="by">by</div><div style={{ color: '#56E6FF', fontSize: 10, fontWeight: 600 }}>Quloi</div></div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <h1>{TITLES[view][0]}</h1>
            <div className="sub">{TITLES[view][1]}</div>
          </div>
          <div className="topbar-right">
            {hasRequirements && (
              <div className="env-chip"><span className="dot" /> {reqCount} requirement{reqCount === 1 ? '' : 's'} loaded</div>
            )}
          </div>
        </div>

        <div className="content">
          {/* NEW RUN */}
          <section className={`view ${view === 'run' ? 'active' : ''}`}>
            <div className="hero">
              <QutieMark size={66} />
              <div className="hero-text">
                <h2>Hi, I'm <b>QUTIE</b>. Let's break things before your users do.</h2>
                <p>I read your FRDs, BRDs, Confluence pages and Jira, write the test cases, run them against your build, and file clean bugs to Jira with evidence.</p>
              </div>
              <div className="hero-glow" />
            </div>

            <div className="card">
              <div className="step-label"><span className="step-num">1</span> Requirement sources</div>
              {!hasRequirements ? (
                <div className="empty" style={{ padding: '30px 20px' }}>
                  <QutieMark size={48} />
                  <p style={{ marginTop: 12 }}>No requirements yet. Upload an FRD or BRD, fetch from Confluence, or connect Jira to get started.</p>
                </div>
              ) : (
                <>
                  {sources.length > 1 && (
                    <div className="source-clear-row">
                      <button type="button" className="source-clear-btn" onClick={handleClearAllRequirements}>
                        Clear all requirements
                      </button>
                    </div>
                  )}
                  <div className="source-row" style={{ marginBottom: 12 }}>
                    {sources.map((s) => (
                      <div key={`${s.sourceType}:${s.sourceRef}`} className="source-chip on">
                        <span>{sourceIcon(s.sourceType)}</span>
                        <div className="source-chip-body">
                          <div>{s.sourceRef}</div>
                          <div style={{ fontSize: 8.8, color: 'var(--t-label)' }}>{s.sourceType.toUpperCase()} · {s.count} requirements</div>
                        </div>
                        <button
                          type="button"
                          className="source-chip-remove"
                          title={`Remove ${s.sourceRef}`}
                          aria-label={`Remove ${s.sourceRef}`}
                          onClick={() => handleRemoveSource(s)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="source-row">
                <div className="source-chip" style={{ borderStyle: 'dashed' }} onClick={() => frdInputRef.current?.click()}>
                  <span>+</span>
                  <div><div>Upload FRD</div><div style={{ fontSize: 8.8, color: 'var(--t-label)' }}>.pdf, .docx, .md, .txt</div></div>
                </div>
                <div className="source-chip" style={{ borderStyle: 'dashed' }} onClick={() => brdInputRef.current?.click()}>
                  <span>+</span>
                  <div><div>Upload BRD</div><div style={{ fontSize: 8.8, color: 'var(--t-label)' }}>.pdf, .docx, .md, .txt</div></div>
                </div>
                <div className="source-chip" style={{ borderStyle: 'dashed' }} onClick={() => setPasteOpen(true)}>
                  <span>+</span>
                  <div><div>Paste text</div><div style={{ fontSize: 8.8, color: 'var(--t-label)' }}>FRD or BRD as plain text</div></div>
                </div>
                <div className="source-chip" style={{ borderStyle: 'dashed' }} onClick={() => setConfluenceOpen(true)}>
                  <span>+</span>
                  <div><div>Confluence</div><div style={{ fontSize: 8.8, color: 'var(--t-label)' }}>Page ID, URL, or search</div></div>
                </div>
                <div className="source-chip" style={{ borderStyle: 'dashed' }} onClick={() => setJiraOpen(true)}>
                  <span>+</span>
                  <div><div>Connect Jira</div><div style={{ fontSize: 8.8, color: 'var(--t-label)' }}>JQL or issue keys</div></div>
                </div>
                <input ref={frdInputRef} type="file" className="hidden-input" accept=".docx,.md,.txt,.pdf" onChange={(e) => handleUpload(e, 'frd')} />
                <input ref={brdInputRef} type="file" className="hidden-input" accept=".docx,.md,.txt,.pdf" onChange={(e) => handleUpload(e, 'brd')} />
              </div>
            </div>

            <div className="card">
              <div className="step-label"><span className="step-num">·</span> Run instructions <span style={{ fontWeight: 400, color: 'var(--t-muted)', fontSize: 9.5 }}>(optional — guides how QUTIE behaves, not what to test)</span></div>
              <div className="field">
                <textarea
                  value={instructions}
                  onChange={(e) => handleInstructionsChange(e.target.value)}
                  rows={3}
                  placeholder='e.g. "focus on login flow", "test against staging", "prioritize design token compliance"'
                  style={{ width: '100%', fontFamily: 'inherit', fontSize: 11, padding: 10, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }}
                />
              </div>
              {instructionsSaved && <div style={{ fontSize: 9, color: 'var(--pass)', marginTop: 6 }}>Instructions saved</div>}
            </div>

            <div className="card">
              <div className="step-label"><span className="step-num">2</span> Target build</div>
              <div className="grid-2">
                <div className="field">
                  <label>Product URL</label>
                  <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://omni-dev.quloi.com or …/login" />
                  <div style={{ fontSize: 9, color: 'var(--t-muted)', marginTop: 4 }}>
                    App base URL for tests. You can paste the login page here (e.g. https://omni-dev.quloi.com/login) — QUTIE detects it and won&apos;t double-navigate.
                  </div>
                </div>
                <div className="field">
                  <label>Login URL <span style={{ fontWeight: 400, color: 'var(--t-muted)' }}>(optional)</span></label>
                  <input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="/login — only if different from Product URL" />
                  <div style={{ fontSize: 9, color: 'var(--t-muted)', marginTop: 4 }}>
                    Leave empty when Product URL is already the sign-in page. Use a path like /login when the app home differs (e.g. Product URL = https://omni-dev.quloi.com).
                  </div>
                </div>
                <div className="field"><label>Browser</label><input value="Chromium (headless)" readOnly /></div>
                <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="test user email" /></div>
                <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="test user password" /></div>
              </div>
              <div className="secure-note">🔒 Credentials are vaulted for this run only, never written to logs, screenshots, or Jira. Production app hosts (app.quloi.com) are blocked by default; dev/staging (omni-dev, *-dev, staging) are allowed. QUTIE waits for React/SPA login forms and handles read-only email fields.</div>
            </div>

            <div className="card">
              <div className="step-label">
                <span className="step-num">3</span> Generate
                <span style={{ marginLeft: 8, fontSize: 8.6, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: aiEnabled ? 'rgba(86,230,255,0.12)' : 'var(--track)', color: aiEnabled ? 'var(--cyan, #56E6FF)' : 'var(--t-muted)', border: '1px solid var(--outline)' }}>
                  {aiEnabled ? '✦ Claude AI' : 'Template mode'}
                </span>
              </div>
              {aiEnabled && (
                <div style={{ fontSize: 9, color: 'var(--t-muted)', marginBottom: 10 }}>
                  Claude reads your requirements — and, if a Product URL and credentials are set above, scouts the live app first so test steps target real selectors.
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button className="btn btn-primary" disabled={generating || !hasRequirements} onClick={handleGenerate}>
                  {generating ? <><span className="spinner" /> Generating…</> : '✦ Generate test cases'}
                </button>
                <span style={{ fontSize: 10, color: genStatus.includes('ready') ? 'var(--pass)' : 'var(--t-muted)' }}>{genStatus}</span>
              </div>
            </div>
          </section>

          {/* TEST CASES */}
          <section className={`view ${view === 'cases' ? 'active' : ''}`}>
            {testCases.length === 0 ? (
              <div className="card"><div className="empty"><QutieMark size={60} /><p>No test cases yet. Add requirements and generate test cases from the New Run view.</p></div></div>
            ) : (
              <>
                <div className="card" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ flex: 1 }}>
                      <div className="card-h" style={{ marginBottom: 8 }}>Requirement coverage</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="covbar"><span className="covbar-fill" style={{ width: `${coverage?.percentage ?? 0}%` }} /></div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{coverage?.percentage ?? 0}%</span>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--t-muted)', marginTop: 7 }}>
                        {coverage?.covered ?? 0} of {coverage?.total ?? 0} requirements covered
                        {(coverage?.uncovered?.length ?? 0) > 0 && <span style={{ color: 'var(--warn)' }}> · {coverage?.uncovered.length} uncovered</span>}
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={handleRun} disabled={running}>
                      {running ? <><span className="spinner" /> Running…</> : `▶ Run suite (${testCases.length})`}
                    </button>
                  </div>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <table className="tbl">
                    <thead><tr><th style={{ width: 28 }}></th><th>ID</th><th>Test case</th><th>Source</th><th>Type</th><th style={{ textAlign: 'right' }}>Steps</th><th style={{ width: 40 }}></th></tr></thead>
                    <tbody>
                      {testCases.map((c) => {
                        const expanded = expandedCases.has(c.id);
                        return (
                          <Fragment key={c.id}>
                            <tr className={expanded ? 'expanded-row' : ''}>
                              <td>
                                <button type="button" className="expand-btn" onClick={() => toggleCaseExpand(c.id)} aria-expanded={expanded} title="View steps">
                                  {expanded ? '▼' : '▶'}
                                </button>
                              </td>
                              <td className="tc-id">{c.id}</td>
                              <td>{c.title}</td>
                              <td><span className="req-link">{c.requirementId}</span></td>
                              <td><span className={`type-badge t-${c.type.toLowerCase()}`}>{c.type}</span></td>
                              <td style={{ textAlign: 'right', color: 'var(--t-muted)' }}>{c.steps?.length ?? 0}</td>
                              <td>
                                <button type="button" className="icon-btn" title={`Remove ${c.id}`} aria-label={`Remove ${c.id}`} onClick={() => handleDeleteCase(c)}>✕</button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="tc-steps-row">
                                <td colSpan={7}>
                                  <div className="tc-steps">
                                    {(c.steps ?? []).map((s) => (
                                      <div key={s.order} className="tc-step">
                                        <span className="n">{s.order}.</span>
                                        <span className="a">{s.action}</span>
                                        <span className="t">{[s.target, s.value ? `= ${s.value}` : ''].filter(Boolean).join(' ')}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="tc-expected"><b>Expected:</b> {c.expectedResult}</div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/* RESULTS */}
          <section className={`view ${view === 'results' ? 'active' : ''}`}>
            {results.length === 0 && !running ? (
              <div className="card">
                <div className="empty">
                  <QutieMark size={60} />
                  {runError ? (
                    <p style={{ color: 'var(--fail)', maxWidth: 520, margin: '12px auto 0', textAlign: 'left', fontSize: 12, lineHeight: 1.5 }}>
                      <strong>Run error:</strong> {runError}
                    </p>
                  ) : (
                    <p>No results yet. Generate test cases and run the suite to see pass/fail outcomes here.</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="runbar">
                  <QutieMark mood={running ? 'scan' : latestRun ? 'neutral' : 'happy'} size={40} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: 'var(--t-secondary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: runLabel === 'Run complete' ? 'var(--pass)' : undefined }}>{runLabel}</span>
                      <span>
                        {liveProgress
                          ? `${liveProgress.completed} / ${liveProgress.total} steps`
                          : runProgress > 0
                            ? `${Math.round(runProgress)}%`
                            : ''}
                      </span>
                    </div>
                    <div className="progtrack"><span className="progtrack-fill" style={{ width: `${runProgress}%` }} /></div>
                  </div>
                </div>

                {(running || liveProgress) && (
                  <div className="card live-panel">
                    <div className="card-h" style={{ marginBottom: 10 }}>Live execution</div>
                    <div className="live-grid">
                      <div className="live-preview">
                        {liveProgress?.latestScreenshotUrl ? (
                          <a href={liveProgress.latestScreenshotUrl} target="_blank" rel="noopener noreferrer">
                            <img src={liveProgress.latestScreenshotUrl} alt="Current step screenshot" className="live-shot" />
                          </a>
                        ) : (
                          <div className="live-shot placeholder">
                            <QutieMark mood="scan" size={36} />
                            <span>Waiting for first screenshot...</span>
                          </div>
                        )}
                        {liveProgress?.currentTestCaseTitle && (
                          <div className="live-current">{liveProgress.currentTestCaseTitle}</div>
                        )}
                      </div>
                      <div className="live-steps">
                        {(liveProgress?.steps ?? []).slice(-12).map((step, i) => (
                          <LiveStepRow key={`${step.stepIndex}-${i}`} step={step} />
                        ))}
                        {running && (!liveProgress?.steps.length) && (
                          <div className="live-step running"><span className="live-step-icon">◎</span> Initializing browser...</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {runError && (
                  <div className="card" style={{ marginTop: 12, padding: 12, borderColor: 'var(--fail)', fontSize: 11, color: 'var(--t-secondary)' }}>
                    {runError}
                  </div>
                )}

                {latestRun?.authNote && !runError && (
                  <div className="card" style={{ marginTop: 12, padding: 12, borderColor: 'var(--pass)', fontSize: 11, color: 'var(--t-secondary)' }}>
                    <strong style={{ color: 'var(--pass)' }}>Auth:</strong> {latestRun.authNote}
                  </div>
                )}

                {latestRun?.loginDebug && latestRun.loginDebug.length > 0 && (
                  <details className="card" style={{ marginTop: 12, padding: 12, fontSize: 10, color: 'var(--t-muted)' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--t-secondary)' }}>Login debug ({latestRun.loginDebug.length} steps)</summary>
                    <ol style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.6 }}>
                      {latestRun.loginDebug.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </details>
                )}

                {latestRun && (
                  <div style={{ fontSize: 9.5, color: 'var(--t-muted)', margin: '2px 2px 10px' }}>
                    Target <span style={{ color: 'var(--t-secondary)', fontWeight: 500 }}>{latestRun.targetUrl}</span>
                    {' · '}Chromium (headless){' · '}{new Date(latestRun.timestamp).toLocaleString()}
                  </div>
                )}

                {latestRun && (
                  <div className="grid-4">
                    <div className="stat"><div className="n">{latestRun.summary.total}</div><div className="l">Tests run</div></div>
                    <div className="stat"><div className="n pass">{latestRun.summary.passed}</div><div className="l">Passed</div></div>
                    <div className="stat"><div className="n fail">{latestRun.summary.failed}</div><div className="l">Failed</div></div>
                    <div className="stat"><div className="n warn">{latestRun.summary.flaky} / {latestRun.summary.blocked}</div><div className="l">Flaky / Blocked</div></div>
                  </div>
                )}

                <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
                  <table className="tbl">
                    <thead><tr><th style={{ width: 28 }}></th><th>ID</th><th>Test case</th><th>Status</th><th>Evidence</th><th>Detail</th></tr></thead>
                    <tbody>
                      {results.map((r) => {
                        const tc = tcMap.get(r.testCaseId);
                        const expanded = expandedResults.has(r.id);
                        const thumb = r.stepEvidence?.[r.stepEvidence.length - 1]?.screenshotUrl;
                        return (
                          <Fragment key={r.id}>
                            <tr className={expanded ? 'expanded-row' : ''}>
                              <td>
                                {(r.stepEvidence?.length ?? 0) > 0 && (
                                  <button type="button" className="expand-btn" onClick={() => toggleResultExpand(r.id)} aria-expanded={expanded}>
                                    {expanded ? '▼' : '▶'}
                                  </button>
                                )}
                              </td>
                              <td className="tc-id">{r.testCaseId}</td>
                              <td>{tc?.title ?? r.testCaseId}</td>
                              <td><StatusBadge status={r.status} /></td>
                              <td>
                                {thumb ? (
                                  <a href={thumb} target="_blank" rel="noopener noreferrer">
                                    <img src={thumb} alt="" className="shot-img" />
                                  </a>
                                ) : r.status === 'fail' || r.status === 'blocked' ? (
                                  <span style={{ fontSize: 8.6, color: 'var(--fail)' }}>failure captured</span>
                                ) : (
                                  <span style={{ fontSize: 8.6, color: 'var(--t-muted)' }}>—</span>
                                )}
                              </td>
                              <td>
                                {r.status === 'fail' || r.status === 'blocked'
                                  ? <span style={{ fontSize: 9, color: r.status === 'blocked' ? 'var(--t-muted)' : 'var(--fail)' }}>{r.actualResult ?? r.status}</span>
                                  : r.status === 'flaky'
                                    ? <span style={{ fontSize: 8.6, color: 'var(--warn)' }}>passed on retry 2/2</span>
                                    : <span style={{ fontSize: 9, color: 'var(--t-muted)' }}>{tc?.requirementId}</span>}
                              </td>
                            </tr>
                            {expanded && r.stepEvidence && r.stepEvidence.length > 0 && (
                              <tr key={`${r.id}-steps`} className="step-evidence-row">
                                <td colSpan={6}>
                                  <div className="step-evidence-list">
                                    {r.stepEvidence.map((ev) => (
                                      <div key={ev.stepIndex} className={`step-evidence-item ${ev.status}`}>
                                        <a href={ev.screenshotUrl} target="_blank" rel="noopener noreferrer">
                                          <img src={ev.screenshotUrl} alt="" className="step-evidence-thumb" />
                                        </a>
                                        <div className="step-evidence-meta">
                                          <div className="step-evidence-desc">{ev.description ?? ev.action}</div>
                                          <div className="step-evidence-time">{new Date(ev.timestamp).toLocaleTimeString()}</div>
                                        </div>
                                        <span className={`step-evidence-status ${ev.status}`}>
                                          {ev.status === 'pass' ? '✓' : ev.status === 'fail' ? '✗' : '…'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/* BUGS */}
          <section className={`view ${view === 'bugs' ? 'active' : ''}`}>
            {!bugs.some((b) => b.isDemo) && (
              <div className="source-clear-row" style={{ marginBottom: 12 }}>
                <button type="button" className="source-clear-btn" onClick={handleSeedDemoBug}>+ Seed demo bug (for presentations)</button>
              </div>
            )}
            {bugs.length === 0 ? (
              <div className="card"><div className="empty"><QutieMark size={60} /><p>No bugs yet. Run the suite and I'll prioritise and prep them for Jira.</p></div></div>
            ) : bugs.map((b) => (
              <div className={`bug ${b.isDemo ? 'bug-demo' : ''}`} key={b.id}>
                <div style={{ flex: 1 }}>
                  <div className="bug-title">
                    {b.isDemo && <span className="demo-badge">DEMO</span>}
                    {b.title}
                  </div>
                  <div className="bug-meta">
                    <span className={`sev sev-${b.severity}`}>{b.severityLabel}</span>
                    <span className="badge b-fail"><span className="d" />{b.priority} priority</span>
                    <span className="req-link">from {b.testCaseId} · {b.requirementId}</span>
                  </div>
                  <div className="bug-body">
                    <b>Expected:</b> {b.expected}<br />
                    <b>Actual:</b> {b.actual}<br />
                    <b>Environment:</b> {b.isDemo ? '[DEMO]' : `${targetUrl} · Chromium`}
                  </div>
                  {b.isDemo && (
                    <button type="button" className="source-clear-btn" style={{ marginTop: 8 }} onClick={() => handleRemoveDemoBug(b.id)}>
                      Remove demo bug
                    </button>
                  )}
                </div>
                <div className="bug-right">
                  {b.evidenceUrl ? (
                    <a href={b.evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ width: '100%' }}>
                      <img src={b.evidenceUrl} alt="Failure screenshot (redacted)" style={{ width: '100%', height: 56, objectFit: 'cover', borderRadius: 6, marginBottom: 10, border: '1px solid var(--outline)' }} />
                    </a>
                  ) : (
                    <div className="shot fail" style={{ width: '100%', height: 56, marginBottom: 10 }}><span className="redact">no screenshot</span></div>
                  )}
                  {b.status === 'filed' || b.status === 'linked' ? (
                    <span className="jira-key" style={{ color: b.status === 'linked' ? 'var(--warn)' : undefined }}>
                      {b.isDemo ? `✓ Simulated ${b.jiraKey} (not real)` : b.status === 'linked' ? `⚡ Linked to ${b.jiraKey}` : `✓ Filed ${b.jiraKey}`}
                    </span>
                  ) : (
                    <button className="btn btn-outline btn-pill" style={{ width: '100%', justifyContent: 'center' }} onClick={() => openBugModal(b)}>
                      Review & file
                    </button>
                  )}
                  {b.status === 'linked' && <div className="dedup">✓ duplicate avoided</div>}
                </div>
              </div>
            ))}
          </section>

          {/* DASHBOARD */}
          <section className={`view ${view === 'dash' ? 'active' : ''}`}>
            {!hasRuns ? (
              <div className="card"><div className="empty"><QutieMark size={60} /><p>No runs yet. Complete a test run to see release readiness, trends, and bug severity here.</p></div></div>
            ) : (
              <>
                <div className="card">
                  <div className="card-h">Release readiness</div>
                  <div className="card-sub">Weighted from pass rate, coverage, open bug severity, and design token compliance</div>
                  <div className="readiness">
                    {(() => {
                      const band = latestRun?.readiness.band ?? 'caution';
                      const bandColor = band === 'go' ? 'var(--pass)' : band === 'no-go' ? 'var(--fail)' : 'var(--warn)';
                      const bugWeight = latestRun?.readiness.inputs?.openBugWeight ?? 0;
                      const bugWeightLabel = bugWeight >= 50 ? 'High' : bugWeight >= 20 ? 'Moderate' : 'Low';
                      return (
                        <>
                          <div className="gauge">
                            <svg viewBox="0 0 160 160" style={{ transform: 'rotate(-90deg)' }}>
                              <circle cx="80" cy="80" r="66" fill="none" stroke="var(--track)" strokeWidth="14" />
                              <circle cx="80" cy="80" r="66" fill="none" stroke={bandColor} strokeWidth="14" strokeLinecap="round"
                                strokeDasharray="414" strokeDashoffset={414 - (414 * (latestRun?.readiness.score ?? gaugeScore)) / 100} />
                            </svg>
                            <div className="mood">
                              <QutieMark mood="neutral" size={52} />
                              <div className="score">{latestRun?.readiness.score ?? gaugeScore}</div>
                              <div className="band" style={{ color: bandColor }}>
                                {band.toUpperCase()}
                              </div>
                            </div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <ScoreRow label="Pass rate" value={`${latestRun?.summary.passRate ?? 0}%`} width={latestRun?.summary.passRate ?? 0} color="var(--outline)" />
                            <ScoreRow label="Requirement coverage" value={`${latestRun?.coverage.percentage ?? coverage?.percentage ?? 0}%`} width={latestRun?.coverage.percentage ?? coverage?.percentage ?? 0} color="var(--outline)" />
                            <ScoreRow label="Design token compliance" value={`${latestRun?.designCompliance ?? 0}%`} width={latestRun?.designCompliance ?? 0} color="var(--pass)" />
                            <ScoreRow label="Open bug weight" value={bugWeightLabel} width={Math.max(bugWeight, 4)} color="var(--fail)" />
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="grid-2">
                  <div className="card">
                    <div className="card-h">Pass rate trend</div>
                    <div className="card-sub">Last five runs</div>
                    {(dashboard?.trend ?? []).length === 0 ? (
                      <div className="empty" style={{ padding: 30 }}><p>Run the suite to build a trend.</p></div>
                    ) : (
                      <div className="trend">
                        {(dashboard?.trend ?? []).map((t) => (
                          <div key={t.label} className={`bar ${t.current ? 'cur' : ''}`}>
                            <div className="val">{t.passRate}%</div>
                            <div className="fill" style={{ height: `${t.passRate}%` }} />
                            <div className="cap">{t.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="card">
                    <div className="card-h">Open bugs by severity</div>
                    <div className="card-sub">From latest run</div>
                    <div style={{ marginTop: 14 }}>
                      {['Critical', 'Major', 'Design', 'Minor'].map((sev) => (
                        <div className="sevrow" key={sev}>
                          <div className="sl">{sev}</div>
                          <div className="mini"><span className="mini-fill" style={{ width: `${(dashboard?.severityCounts[sev] ?? 0) * 33}%`, background: sev === 'Critical' ? 'var(--alert)' : sev === 'Major' ? '#b46a1e' : sev === 'Design' ? '#6a3bc0' : 'var(--new)' }} /></div>
                          <div className="sc">{dashboard?.severityCounts[sev] ?? (latestRun ? countSeverity(latestRun.bugs, sev) : 0)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {/* CONFLUENCE MODAL */}
      <div className={`overlay ${confluenceOpen ? 'on' : ''}`}>
        <div className="modal">
          <div className="modal-h"><h3>Fetch from Confluence</h3><button className="btn btn-ghost" onClick={() => setConfluenceOpen(false)}>✕</button></div>
          <div className="modal-b">
            <div style={{ fontSize: 9, color: 'var(--t-muted)', marginBottom: 12 }}>
              Uses CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN from server env (or JIRA_* fallbacks).
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Base URL (optional)</label>
              <input value={confluenceBaseUrl} onChange={(e) => setConfluenceBaseUrl(e.target.value)} placeholder="https://your-org.atlassian.net" style={{ width: '100%', padding: 10, fontSize: 11, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['pageUrl', 'pageId', 'search'] as const).map((mode) => (
                <button key={mode} className={`btn ${confluenceMode === mode ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 9 }} onClick={() => setConfluenceMode(mode)}>
                  {mode === 'pageUrl' ? 'Page URL' : mode === 'pageId' ? 'Page ID' : 'Space + title'}
                </button>
              ))}
            </div>
            {confluenceMode === 'pageUrl' && (
              <div className="field">
                <label>Page URL</label>
                <input value={confluencePageUrl} onChange={(e) => setConfluencePageUrl(e.target.value)} placeholder="https://your-org.atlassian.net/wiki/spaces/SPACE/pages/123456/Title" style={{ width: '100%', padding: 10, fontSize: 11, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }} />
              </div>
            )}
            {confluenceMode === 'pageId' && (
              <div className="field">
                <label>Page ID</label>
                <input value={confluencePageId} onChange={(e) => setConfluencePageId(e.target.value)} placeholder="123456789" style={{ width: '100%', padding: 10, fontSize: 11, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }} />
              </div>
            )}
            {confluenceMode === 'search' && (
              <div className="grid-2">
                <div className="field"><label>Space key</label><input value={confluenceSpaceKey} onChange={(e) => setConfluenceSpaceKey(e.target.value)} placeholder="PROJ" style={{ width: '100%', padding: 10, fontSize: 11, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }} /></div>
                <div className="field"><label>Page title</label><input value={confluenceTitle} onChange={(e) => setConfluenceTitle(e.target.value)} placeholder="Functional Requirements" style={{ width: '100%', padding: 10, fontSize: 11, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }} /></div>
              </div>
            )}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={() => setConfluenceOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleConfluenceIngest}>Fetch page</button>
          </div>
        </div>
      </div>

      {/* PASTE TEXT MODAL */}
      <div className={`overlay ${pasteOpen ? 'on' : ''}`}>
        <div className="modal">
          <div className="modal-h"><h3>Paste requirements</h3><button className="btn btn-ghost" onClick={() => setPasteOpen(false)}>✕</button></div>
          <div className="modal-b">
            <div style={{ fontSize: 9, color: 'var(--t-muted)', marginBottom: 9 }}>
              Paste FRD/BRD text. QUTIE extracts FR-/BRD-numbered requirements, or falls back to numbered sections.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['frd', 'brd'] as const).map((st) => (
                <button key={st} className={`btn ${pasteSourceType === st ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 9 }} onClick={() => setPasteSourceType(st)}>
                  {st.toUpperCase()}
                </button>
              ))}
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              placeholder="FR-1 The system shall ..."
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 11, padding: 10, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }}
            />
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={() => setPasteOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={pasteText.trim().length < 20} onClick={handlePasteIngest}>Ingest text</button>
          </div>
        </div>
      </div>

      {/* JIRA MODAL */}
      <div className={`overlay ${jiraOpen ? 'on' : ''}`}>
        <div className="modal">
          <div className="modal-h"><h3>Connect Jira</h3><button className="btn btn-ghost" onClick={() => setJiraOpen(false)}>✕</button></div>
          <div className="modal-b">
            <div style={{ fontSize: 9, color: 'var(--t-muted)', marginBottom: 9 }}>Enter a JQL query. Requires JIRA_EMAIL and JIRA_API_TOKEN in server env.</div>
            <input value={jiraQuery} onChange={(e) => setJiraQuery(e.target.value)} placeholder="project=MYPROJ ORDER BY created DESC" style={{ width: '100%', padding: 10, fontSize: 11, borderRadius: 8, border: '1px solid var(--outline)', background: 'var(--surface)', color: 'var(--t-primary)' }} />
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={() => setJiraOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleJiraIngest}>Fetch issues</button>
          </div>
        </div>
      </div>

      {/* JIRA FILE MODAL */}
      <div className={`overlay ${modalOpen ? 'on' : ''}`}>
        <div className="modal">
          <div className="modal-h"><h3>Review before filing</h3><button className="btn btn-ghost" onClick={() => setModalOpen(false)}>✕</button></div>
          <div className="modal-b">
            <div style={{ fontSize: 9, color: 'var(--t-muted)', marginBottom: 9 }}>Exact Jira payload QUTIE will send. Nothing is written until you confirm.</div>
            <div className="payload">{modalPayload}</div>
            {activeBug && activeBug.status !== 'duplicate' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <label style={{ fontSize: 9.5, color: 'var(--t-secondary)', fontWeight: 500 }}>Priority</label>
                <select
                  value={priorityOverride}
                  onChange={(e) => setPriorityOverride(e.target.value)}
                  style={{ width: 140 }}
                >
                  {['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'].map((p) => (
                    <option key={p} value={p}>{p}{p === activeBug.priority ? ' (suggested)' : ''}</option>
                  ))}
                </select>
                <span style={{ fontSize: 8.8, color: 'var(--t-muted)' }}>Override before filing if you disagree with QUTIE's call</span>
              </div>
            )}
          </div>
          <div className="modal-f">
            <span className="gate">⚠ Confirmation required before any Jira write</span>
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmFile} disabled={filing}>
              {filing ? <><span className="spinner" /> Filing…</> : 'Confirm & file'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveStepRow({ step }: { step: ProgressStep }) {
  const icon = step.status === 'complete' ? '✓' : step.status === 'fail' ? '✗' : '◎';
  const cls = step.status === 'complete' ? 'complete' : step.status === 'fail' ? 'fail' : 'running';
  return (
    <div className={`live-step ${cls}`}>
      <span className="live-step-icon">{icon}</span>
      <span className="live-step-text">{step.description}</span>
      {step.screenshotUrl && (
        <a href={step.screenshotUrl} target="_blank" rel="noopener noreferrer" className="live-step-link">view</a>
      )}
    </div>
  );
}

function ScoreRow({ label, value, width, color }: { label: string; value: string; width: number; color: string }) {
  return (
    <div className="rd-row">
      <div className="rl">{label}</div>
      <div className="mini"><span className="mini-fill" style={{ width: `${width}%`, background: color }} /></div>
      <div className="rv">{value}</div>
    </div>
  );
}

function countSeverity(bugs: BugReport[], sev: string) {
  return bugs.filter((b) => b.severityLabel === sev).length;
}

function NavIcon({ view }: { view: View }) {
  const props = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, width: 20, height: 20 };
  if (view === 'run') return <svg {...props}><path d="M5 3l14 9-14 9V3z" /></svg>;
  if (view === 'cases') return <svg {...props}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>;
  if (view === 'results') return <svg {...props}><path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  if (view === 'bugs') return <svg {...props}><path d="M8 6l1-2m6 2l-1-2M12 20a5 5 0 005-5v-3a5 5 0 00-10 0v3a5 5 0 005 5z" /></svg>;
  return <svg {...props}><path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z" /></svg>;
}
