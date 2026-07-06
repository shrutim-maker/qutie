const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  return res.json();
}

export interface RequirementSource {
  sourceType: string;
  sourceRef: string;
  count: number;
}

export interface ConfluenceIngestBody {
  pageId?: string;
  pageUrl?: string;
  spaceKey?: string;
  title?: string;
  baseUrl?: string;
  email?: string;
  apiToken?: string;
}

export interface GenerateBody {
  instructions?: string;
  targetUrl?: string;
  loginUrl?: string;
  username?: string;
  password?: string;
}

export const api = {
  health: () => request<{ status: string; aiGeneration?: boolean }>('/health'),
  getRequirements: () =>
    request<{ requirements: import('./types').Requirement[]; total: number; sources: RequirementSource[] }>('/requirements'),
  deleteRequirementSource: (sourceType: string, sourceRef: string) =>
    request<{ removed: number; requirements: import('./types').Requirement[]; total: number; sources: RequirementSource[] }>(
      '/requirements/source',
      { method: 'DELETE', body: JSON.stringify({ sourceType, sourceRef }) }
    ),
  clearRequirements: () =>
    request<{ removed: number; requirements: import('./types').Requirement[]; total: number; sources: RequirementSource[] }>(
      '/requirements',
      { method: 'DELETE' }
    ),
  clearRuns: () => request<{ removed: number }>('/runs', { method: 'DELETE' }),
  getInstructions: () => request<{ instructions: string }>('/instructions'),
  setInstructions: (instructions: string) =>
    request<{ instructions: string }>('/instructions', { method: 'POST', body: JSON.stringify({ instructions }) }),
  ingestUpload: (file: File, sourceType: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('sourceType', sourceType);
    return fetch(`${BASE}/ingest/upload`, { method: 'POST', body: fd }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Upload failed');
      return data;
    });
  },
  ingestPaste: (text: string, sourceType: 'frd' | 'brd', sourceRef?: string) =>
    request<{ added: number; total: number; sources: RequirementSource[]; extractor?: 'ai' | 'heuristic'; extractorNote?: string }>(
      '/ingest/paste',
      { method: 'POST', body: JSON.stringify({ text, sourceType, sourceRef }) }
    ),
  ingestConfluence: (body: ConfluenceIngestBody) =>
    request<{
      requirements: import('./types').Requirement[];
      total: number;
      page: { id: string; title: string; webUrl: string };
      extractor?: 'ai' | 'heuristic';
      extractorNote?: string;
    }>('/ingest/confluence', { method: 'POST', body: JSON.stringify(body) }),
  ingestJira: (jql?: string, issueKeys?: string[]) =>
    request<{ requirements: import('./types').Requirement[]; total: number; configured?: boolean }>('/ingest/jira', {
      method: 'POST',
      body: JSON.stringify({ jql, issueKeys }),
    }),
  generate: (body: GenerateBody = {}) =>
    request<{
      testCases: import('./types').TestCase[];
      coverage: import('./types').Coverage;
      generator?: 'ai' | 'heuristic';
      generatorNote?: string;
    }>('/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTestCases: () => request<{ testCases: import('./types').TestCase[]; coverage: import('./types').Coverage }>('/test-cases'),
  deleteTestCase: (id: string) => request<{ ok: boolean }>(`/test-cases/${id}`, { method: 'DELETE' }),
  run: (body: { targetUrl: string; loginUrl?: string; username: string; password: string; instructions?: string }) =>
    request<{ runId: string; status: string }>('/run', { method: 'POST', body: JSON.stringify(body) }),
  getRunProgress: (runId: string) => request<import('./types').RunProgress>(`/run/${runId}/progress`),
  getRun: (runId: string) => request<import('./types').TestRun>(`/run/${runId}`),
  getBugs: () => request<{ bugs: import('./types').BugReport[] }>('/bugs'),
  seedDemoBug: () => request<{ bug: import('./types').BugReport }>('/bugs/demo', { method: 'POST' }),
  deleteBug: (id: string) => request<{ ok: boolean }>(`/bugs/${id}`, { method: 'DELETE' }),
  previewBug: (id: string) => request<{ payload: import('./types').JiraPayload; bug: import('./types').BugReport; duplicate: boolean }>(`/bugs/${id}/preview`, { method: 'POST' }),
  fileBug: (id: string, overrides: { priority?: string } = {}) =>
    request<{ bug: import('./types').BugReport; filed: { key: string; mode: string }; payload: import('./types').JiraPayload }>(`/bugs/${id}/file`, {
      method: 'POST',
      body: JSON.stringify(overrides),
    }),
  getDashboard: () => request<{ latest: import('./types').TestRun | null; trend: Array<{ label: string; passRate: number; current?: boolean }>; severityCounts: Record<string, number>; runs: number }>('/dashboard'),
};
