#!/usr/bin/env node
/**
 * Test Jira connectivity using credentials from project .env (never logs secrets).
 * Usage: node scripts/test-jira-connection.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const baseUrl = process.env.JIRA_BASE_URL ?? 'https://quloi-testing-tool.atlassian.net';
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;

if (!token) {
  console.error('FAIL: JIRA_API_TOKEN not set in .env');
  process.exit(1);
}

if (!email) {
  console.log('SKIP: JIRA_EMAIL not set — Atlassian Cloud requires email + API token for Basic auth.');
  console.log('Add JIRA_EMAIL=your-atlassian-account@email.com to .env and re-run.');
  process.exit(2);
}

const auth = Buffer.from(`${email}:${token}`).toString('base64');

async function jiraGet(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, ok: res.ok, body };
}

const myself = await jiraGet('/rest/api/3/myself');
if (!myself.ok) {
  console.error(`FAIL: /myself returned ${myself.status}`);
  console.error(typeof myself.body === 'object' ? JSON.stringify(myself.body, null, 2) : myself.body);
  process.exit(1);
}

console.log('OK: Authenticated as', myself.body.displayName ?? myself.body.emailAddress);

const projects = await jiraGet('/rest/api/3/project/search?maxResults=50');
if (!projects.ok) {
  console.error(`FAIL: project list returned ${projects.status}`);
  process.exit(1);
}

const values = projects.body.values ?? [];
console.log(`OK: Found ${values.length} project(s):`);
for (const p of values) {
  console.log(`  - ${p.key}: ${p.name}`);
}

const board = await jiraGet('/rest/agile/1.0/board/1');
if (board.ok && board.body?.location?.projectKey) {
  console.log(`OK: Board 1 → project key ${board.body.location.projectKey}`);
}

const projectKey = process.env.JIRA_PROJECT_KEY ?? 'SCRUM';
const createMeta = await jiraGet(
  `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeNames=Bug&expand=projects.issuetypes.fields`
);
if (createMeta.ok) {
  console.log(`OK: Bug issue type available in project ${projectKey} (file-bug ready)`);
} else {
  console.error(`WARN: createmeta returned ${createMeta.status} — file-bug may fail`);
}
