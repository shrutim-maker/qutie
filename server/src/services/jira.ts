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
    baseUrl: process.env.JIRA_BASE_URL ?? 'https://quloi-testing-tool.atlassian.net',
    email,
    apiToken,
    projectKey: process.env.JIRA_PROJECT_KEY ?? 'QUTIE',
  };
}

export function buildJiraPayload(bug: BugReport, attachmentName?: string): JiraPayload {
  const projectKey = getJiraConfig()?.projectKey ?? process.env.JIRA_PROJECT_KEY ?? 'QUTIE';
  return {
    project: { key: projectKey },
    issuetype: 'Bug',
    summary: bug.title,
    priority: bug.priority,
    labels: ['qutie', bug.severityLabel.toLowerCase(), 'auto-qa'],
    description: `Expected: ${bug.expected ?? 'N/A'} | Actual: ${bug.actual ?? 'N/A'}`,
    customfield_req: bug.requirementId,
    attachments: attachmentName ? [attachmentName] : [],
  };
}

export async function fileBugToJira(
  bug: BugReport,
  payload: JiraPayload,
  evidencePath?: string,
  actor = 'user'
): Promise<{ key: string; mode: 'created' | 'linked' | 'mock' }> {
  const config = getJiraConfig();

  if (bug.status === 'duplicate') {
    audit(actor, 'jira_link', { bugId: bug.id, existingKey: bug.jiraKey });
    return { key: bug.jiraKey ?? 'EXISTING', mode: 'linked' };
  }

  if (!config) {
    const mockKey = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    audit(actor, 'jira_mock_file', { bugId: bug.id, mockKey, payload });
    return { key: mockKey, mode: 'mock' };
  }

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const body = {
    fields: {
      project: payload.project,
      issuetype: { name: payload.issuetype },
      summary: payload.summary,
      priority: { name: payload.priority },
      labels: payload.labels,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: payload.description }],
          },
        ],
      },
    },
  };

  const res = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jira API error: ${res.status} ${err}`);
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

  if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);
  const data = (await res.json()) as {
    issues: Array<{ key: string; fields: { summary: string; description?: unknown } }>;
  };

  return data.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    description: extractPlainDescription(i.fields.description),
  }));
}
