import fs from 'fs';
import path from 'path';
import type { BugReport } from '../types.js';
import { audit } from '../db.js';

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

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export function getJiraConfig(): JiraConfig | null {
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!email || !apiToken) return null;
  return {
    // FR-22: MVP files bugs to the HACK sandbox project on quloi.atlassian.net
    baseUrl: process.env.JIRA_BASE_URL ?? 'https://quloi.atlassian.net',
    email,
    apiToken,
    projectKey: process.env.JIRA_PROJECT_KEY ?? 'HACK',
  };
}

export function buildJiraPayload(bug: BugReport, attachmentName?: string): JiraPayload {
  const projectKey = getJiraConfig()?.projectKey ?? process.env.JIRA_PROJECT_KEY ?? 'HACK';
  // FR-21: file the full structured report (repro steps, expected vs actual, environment, links)
  const description = [
    bug.reportBody,
    ``,
    `*Test case:* ${bug.testCaseId}`,
    `*Requirement:* ${bug.requirementId}`,
  ].join('\n');
  return {
    project: { key: projectKey },
    issuetype: 'Bug',
    summary: bug.title,
    priority: bug.priority,
    labels: ['qutie', bug.severityLabel.toLowerCase(), 'auto-qa'],
    description,
    customfield_req: bug.requirementId,
    attachments: attachmentName ? [attachmentName] : [],
  };
}

function toAdfDoc(text: string) {
  const paragraphs = text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }));
  return { type: 'doc', version: 1, content: paragraphs };
}

/** FR-24: comment on an existing open issue instead of creating a duplicate. */
export async function addJiraComment(issueKey: string, text: string): Promise<boolean> {
  const config = getJiraConfig();
  if (!config) return false;
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const res = await fetch(`${config.baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ body: toAdfDoc(text) }),
  });
  return res.ok;
}

export async function fileBugToJira(
  bug: BugReport,
  payload: JiraPayload,
  evidencePath?: string,
  actor = 'user'
): Promise<{ key: string; mode: 'created' | 'linked' | 'mock' }> {
  const config = getJiraConfig();

  if (bug.status === 'duplicate') {
    const existingKey = bug.jiraKey;
    if (config && existingKey && !existingKey.startsWith('MOCK')) {
      await addJiraComment(
        existingKey,
        `QUTIE detected this failure again.\n${payload.description}`
      ).catch(() => false);
    }
    audit(actor, 'jira_link', { bugId: bug.id, existingKey });
    return { key: existingKey ?? 'EXISTING', mode: 'linked' };
  }

  if (!config) {
    const mockKey = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    audit(actor, 'jira_mock_file', { bugId: bug.id, mockKey, payload });
    return { key: mockKey, mode: 'mock' };
  }

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const buildBody = (includePriority: boolean) => ({
    fields: {
      project: payload.project,
      issuetype: { name: payload.issuetype },
      summary: payload.summary,
      ...(includePriority ? { priority: { name: payload.priority } } : {}),
      labels: payload.labels,
      description: toAdfDoc(payload.description),
    },
  });

  const createIssue = (includePriority: boolean) =>
    fetch(`${config.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildBody(includePriority)),
    });

  let res = await createIssue(true);

  if (!res.ok) {
    const err = await res.text();
    // Retry without priority when the Jira project uses a different priority scheme
    if (/priority/i.test(err)) {
      res = await createIssue(false);
      if (!res.ok) {
        throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
      }
    } else {
      throw new Error(`Jira API error: ${res.status} ${err}`);
    }
  }

  const data = (await res.json()) as { key: string };

  if (evidencePath && fs.existsSync(evidencePath)) {
    await attachScreenshot(config, data.key, evidencePath, auth);
  }

  audit(actor, 'jira_create', { bugId: bug.id, jiraKey: data.key });
  return { key: data.key, mode: 'created' };
}

async function attachScreenshot(config: JiraConfig, issueKey: string, filePath: string, auth: string) {
  const formData = new FormData();
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'image/png' });
  formData.append('file', blob, path.basename(filePath));

  await fetch(`${config.baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'X-Atlassian-Token': 'no-check',
    },
    body: formData,
  });
}

function extractPlainDescription(description: unknown): string | undefined {
  if (typeof description === 'string') return description;
  if (!description || typeof description !== 'object') return undefined;
  const doc = description as { content?: Array<{ content?: Array<{ text?: string }> }> };
  const parts: string[] = [];
  for (const block of doc.content ?? []) {
    for (const inline of block.content ?? []) {
      if (inline.text) parts.push(inline.text);
    }
  }
  return parts.join(' ').trim() || undefined;
}

export async function fetchJiraIssuesByKeys(
  keys: string[]
): Promise<Array<{ key: string; summary: string; description?: string }>> {
  if (!keys.length) return [];
  const jql = `key in (${keys.map((k) => `"${k.replace(/"/g, '')}"`).join(',')}) ORDER BY key`;
  return fetchJiraIssues(jql);
}

/** Extract an issue key from either a bare key ("PROJ-123") or a full ticket URL (.../browse/PROJ-123). */
export function parseJiraKeyFromInput(input: string): string | null {
  const trimmed = input.trim();
  const bareMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*-\d+)$/);
  if (bareMatch) return bareMatch[1].toUpperCase();
  const urlMatch = trimmed.match(/\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  return null;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  contentUrl: string;
  size: number;
}

/** Fetch a single issue's summary/description plus its attachment list (not included in bulk JQL search). */
export async function fetchJiraIssueWithAttachments(key: string): Promise<{
  key: string;
  summary: string;
  description?: string;
  attachments: JiraAttachment[];
}> {
  const config = getJiraConfig();
  if (!config) {
    throw new Error('Jira is not configured. Set JIRA_EMAIL and JIRA_API_TOKEN.');
  }
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const res = await fetch(`${config.baseUrl}/rest/api/3/issue/${key}?fields=summary,description,attachment`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Could not fetch Jira issue ${key} (${res.status}): ${body.slice(0, 300) || 'no details returned'}`);
  }
  const data = (await res.json()) as {
    key: string;
    fields: {
      summary: string;
      description?: unknown;
      attachment?: Array<{ id: string; filename: string; mimeType: string; content: string; size: number }>;
    };
  };
  return {
    key: data.key,
    summary: data.fields.summary,
    description: extractPlainDescription(data.fields.description),
    attachments: (data.fields.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      contentUrl: a.content,
      size: a.size,
    })),
  };
}

export async function downloadJiraAttachment(contentUrl: string): Promise<Buffer> {
  const config = getJiraConfig();
  if (!config) throw new Error('Jira is not configured.');
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const res = await fetch(contentUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Could not download attachment (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchJiraIssues(jql: string): Promise<
  Array<{ key: string; summary: string; description?: string }>
> {
  const config = getJiraConfig();
  if (!config) {
    return [];
  }

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const res = await fetch(`${config.baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ jql, maxResults: 50, fields: ['summary', 'description'] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { errorMessages?: string[] };
      if (parsed.errorMessages?.length) detail = parsed.errorMessages.join('; ');
    } catch {
      /* not JSON — use raw body */
    }
    throw new Error(`Jira search failed (${res.status}): ${detail || 'no details returned'}`);
  }
  const data = (await res.json()) as {
    issues: Array<{ key: string; fields: { summary: string; description?: unknown } }>;
  };

  return data.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    description: extractPlainDescription(i.fields.description),
  }));
}
