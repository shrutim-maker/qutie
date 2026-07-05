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

export const api = {
  health: () => request<{ status: string }>('/health'),
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
  ingestConfluence: (body: ConfluenceIngestBody) =>
    request<{ requirements: import('./types').Requirement[]; total: number; page: { id: string; title: string; webUrl: string } }>(
      '/ingest/confluence',
      { method: 'POST', body: JSON.stringify(body) }
    ),
  ingestJira: (jql?: string, issueKeys?: string[]) =>
    request<{ requirements: import('./types').Requirement[]; total: number; configured?: boolean }>('/ingest/jira', {
      method: 'POST',
      body: JSON.stringify({ jql, issueKeys }),
    }),
  generate: (instructions?: string) =>
    request<{ testCases: import('./types').TestCase[]; coverage: import('./types').Coverage }>('/generate', {
      method: 'POST',
      body: JSON.stringify(instructions !== undefined ? { instructions } : {}),
    }),
  getTestCases: () => request<{ testCases: import('./types').TestCase[]; coverage: import('./types').Coverage }>('/test-cases'),
  run: (body: { targetUrl: string; loginUrl?: string; username: string; password: string; brokenMode?: boolean; instructions?: string }) =>
    request<{ runId: string; status: string }>('/run', { method: 'POST', body: JSON.stringify(body) }),
  getRunProgress: (runId: string) => request<import('./types').RunProgress>(`/run/${runId}/progress`),
  getRun: (runId: string) => request<import('./types').TestRun>(`/run/${runId}`),
  getBugs: () => request<{ bugs: import('./types').BugReport[] }>('/bugs'),
  previewBug: (id: string) => request<{ payload: import('./types').JiraPayload; bug: import('./types').BugReport; duplicate: boolean }>(`/bugs/${id}/preview`, { method: 'POST' }),
  fileBug: (id: string) => request<{ bug: import('./types').BugReport; filed: { key: string; mode: string }; payload: import('./types').JiraPayload }>(`/bugs/${id}/file`, { method: 'POST', body: '{}' }),
  getDashboard: () => request<{ latest: import('./types').TestRun | null; trend: Array<{ label: string; passRate: number; current?: boolean }>; severityCounts: Record<string, number>; runs: number }>('/dashboard'),
};
