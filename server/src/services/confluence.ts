import type { ExtractionResult } from './ingestion.js';
import { parseConfluenceContent } from './ingestion.js';

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  body: string;
  webUrl: string;
}

export function getConfluenceConfig(overrides?: {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
}): ConfluenceConfig | null {
  const email = overrides?.email ?? process.env.CONFLUENCE_EMAIL ?? process.env.JIRA_EMAIL;
  const apiToken = overrides?.apiToken ?? process.env.CONFLUENCE_API_TOKEN ?? process.env.JIRA_API_TOKEN;
  if (!email || !apiToken) return null;

  const baseUrl = (
    overrides?.baseUrl ??
    process.env.CONFLUENCE_BASE_URL ??
    process.env.JIRA_BASE_URL ??
    ''
  ).replace(/\/$/, '');

  if (!baseUrl) return null;
  return { baseUrl, email, apiToken };
}

function authHeader(config: ConfluenceConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
}

function apiBase(config: ConfluenceConfig): string {
  return `${config.baseUrl}/wiki/rest/api`;
}

/** Strip Confluence storage-format HTML to plain text. */
export function storageToPlainText(html: string): string {
  return html
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parsePageIdFromUrl(pageUrl: string): string | null {
  const match = pageUrl.match(/\/pages\/(\d+)/);
  return match?.[1] ?? null;
}

interface ConfluenceApiPage {
  id: string;
  title: string;
  _links?: { webui?: string; base?: string };
  body?: { storage?: { value?: string } };
}

function toPage(config: ConfluenceConfig, raw: ConfluenceApiPage): ConfluencePage {
  const body = storageToPlainText(raw.body?.storage?.value ?? '');
  const webUrl = raw._links?.webui
    ? `${config.baseUrl}/wiki${raw._links.webui}`
    : `${config.baseUrl}/wiki/spaces/pages/${raw.id}`;
  return { id: raw.id, title: raw.title, body, webUrl };
}

async function fetchPageRaw(config: ConfluenceConfig, pageId: string): Promise<ConfluenceApiPage> {
  const res = await fetch(`${apiBase(config)}/content/${pageId}?expand=body.storage,title`, {
    headers: { Authorization: authHeader(config), Accept: 'application/json' },
  });
  if (res.status === 404) throw new Error(`Confluence page not found: ${pageId}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Confluence API error: ${res.status} ${err}`);
  }
  return res.json() as Promise<ConfluenceApiPage>;
}

export async function fetchConfluencePageById(
  pageId: string,
  overrides?: { baseUrl?: string; email?: string; apiToken?: string }
): Promise<ConfluencePage> {
  const config = getConfluenceConfig(overrides);
  if (!config) {
    throw new Error(
      'Confluence is not configured. Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN (or JIRA_* equivalents).'
    );
  }
  return toPage(config, await fetchPageRaw(config, pageId));
}

export async function fetchConfluencePageByUrl(
  pageUrl: string,
  overrides?: { baseUrl?: string; email?: string; apiToken?: string }
): Promise<ConfluencePage> {
  const pageId = parsePageIdFromUrl(pageUrl);
  if (!pageId) throw new Error('Could not parse page ID from Confluence URL');
  return fetchConfluencePageById(pageId, overrides);
}

export async function fetchConfluencePageByTitle(
  spaceKey: string,
  title: string,
  overrides?: { baseUrl?: string; email?: string; apiToken?: string }
): Promise<ConfluencePage> {
  const config = getConfluenceConfig(overrides);
  if (!config) {
    throw new Error(
      'Confluence is not configured. Set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN (or JIRA_* equivalents).'
    );
  }

  const params = new URLSearchParams({
    spaceKey,
    title,
    expand: 'body.storage,title',
  });
  const res = await fetch(`${apiBase(config)}/content?${params}`, {
    headers: { Authorization: authHeader(config), Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Confluence search failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { results: ConfluenceApiPage[] };
  if (!data.results?.length) {
    throw new Error(`No Confluence page found in space "${spaceKey}" with title "${title}"`);
  }
  return toPage(config, data.results[0]);
}

export function ingestConfluencePage(page: ConfluencePage): Promise<ExtractionResult> {
  return parseConfluenceContent(page.body, page.title || page.webUrl);
}
