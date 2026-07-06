import mammoth from 'mammoth';
import path from 'path';
import { createRequire } from 'module';
import type { Requirement } from '../types.js';

// pdf-parse is CJS-only; import the lib entry directly to avoid its debug-mode side effects
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buffer: Buffer) => Promise<{ text: string }>;

const AMBIGUOUS_PATTERNS = [
  /\bshould be (?:fast|good|nice|user.?friendly)\b/i,
  /\bas needed\b/i,
  /\betc\.?\b/i,
  /\bTBD\b/i,
  /\bto be determined\b/i,
];

const FR_PATTERN = /\b(FR-\d+)\b[^.]*?(?:shall|must|will)\s+(.+?)(?=\n\n|FR-\d+|$)/gis;
const FR_LINE_PATTERN = /^(FR-\d+)\s+(.+)$/gim;
const BRD_PATTERN = /\b(BRD-\d+)\b[^.]*?(?:shall|must|will)\s+(.+?)(?=\n\n|BRD-\d+|$)/gis;
const BRD_LINE_PATTERN = /^(BRD-\d+)\s+(.+)$/gim;

/** Requirement-bearing language — used to pull real requirements out of prose/bullet BRDs
 * that don't use FR-/BRD- numbering (the common case for real-world documents). */
const REQUIREMENT_VERB_PATTERN =
  /\b(shall|must|should|will|needs? to|has to|is required to|ensures?|provides?|prevents?|allows?|restricts?|validates?|rejects?|displays?|requires?|supports?|enables?|disables?|redirects?|authenticates?|verif(?:y|ies))\b/i;

const BULLET_LINE_PATTERN = /^\s*(?:[•●▪○*-]|\d+[.)]|[a-z][.)])\s+(.+)$/gim;

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isAmbiguous(text: string): boolean {
  return AMBIGUOUS_PATTERNS.some((p) => p.test(text));
}

function isTestable(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('pluggable') || lower.includes('extensibility')) return false;
  if (lower.includes('auditability') && lower.includes('logged')) return false;
  return !isAmbiguous(text);
}

/** Push a heuristically-found requirement, skipping near-duplicates by normalized text. */
function pushHeuristicRequirement(
  reqs: Requirement[],
  seenText: Set<string>,
  counter: { n: number },
  sourceType: 'frd' | 'brd' | 'confluence',
  sourceRef: string,
  rawBody: string,
  opts?: { forceAmbiguous?: boolean }
): void {
  const body = rawBody
    .replace(/^[•●▪○*-]\s+/, '')
    .replace(/^\d+(?:\.\d+)*\s+/, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (body.length < 10) return;
  const norm = normalizeForDedup(body);
  if (seenText.has(norm)) return;
  seenText.add(norm);
  reqs.push({
    id: `REQ-${String(counter.n++).padStart(3, '0')}`,
    sourceType,
    sourceRef,
    text: body,
    testable: opts?.forceAmbiguous ? false : isTestable(body),
    ambiguous: opts?.forceAmbiguous ? true : isAmbiguous(body),
  });
}

/** Pull individual bullet/numbered list items that read like requirements (not data points). */
function extractBulletCandidates(text: string): string[] {
  const candidates: string[] = [];
  const re = new RegExp(BULLET_LINE_PATTERN.source, 'gim');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1].trim();
    if (body.length >= 15 && body.length <= 400 && REQUIREMENT_VERB_PATTERN.test(body)) {
      candidates.push(body);
    }
  }
  return candidates;
}

/** Pull requirement-bearing sentences out of ordinary prose paragraphs. */
function extractSentenceCandidates(text: string): string[] {
  // Drop bullet lines first (handled separately by extractBulletCandidates) so a bullet
  // never bleeds into an adjacent sentence when there's no punctuation between them.
  const withoutBullets = text.replace(new RegExp(BULLET_LINE_PATTERN.source, 'gim'), '');
  // Segment by numbered sub-headers (e.g. "2.1", "3.2") first — without this, unrelated
  // numbered items with no punctuation between them (common in real BRDs) merge into one run.
  const blocks = withoutBullets.split(/\n(?=\d+(?:\.\d+)*\s)/);
  const results: string[] = [];
  for (const block of blocks) {
    const collapsed = block.replace(/\s+/g, ' ').trim();
    const sentences = collapsed.split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length >= 15 && trimmed.length <= 400 && REQUIREMENT_VERB_PATTERN.test(trimmed)) {
        results.push(trimmed);
      }
    }
  }
  return results;
}

function extractFrRequirements(
  text: string,
  sourceType: 'frd' | 'brd' | 'confluence',
  sourceRef: string
): Requirement[] {
  const reqs: Requirement[] = [];
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const counter = { n: 1 };

  // Match "FR-1 QUTIE shall ..." / "BRD-1 ... shall ..." block style
  let match: RegExpExecArray | null;
  for (const pattern of [FR_PATTERN, BRD_PATTERN]) {
    const combined = new RegExp(pattern.source, 'gis');
    while ((match = combined.exec(text)) !== null) {
      const id = match[1];
      if (seenIds.has(id)) continue;
      const body = match[2].trim().replace(/\s+/g, ' ');
      if (body.length < 10) continue;
      seenIds.add(id);
      seenText.add(normalizeForDedup(body));
      reqs.push({ id, sourceType, sourceRef, text: body, testable: isTestable(body), ambiguous: isAmbiguous(body) });
    }
  }

  // Fallback: line-by-line "FR-XX ..." / "BRD-XX ..."
  for (const pattern of [FR_LINE_PATTERN, BRD_LINE_PATTERN]) {
    const lineRe = new RegExp(pattern.source, 'gim');
    while ((match = lineRe.exec(text)) !== null) {
      const id = match[1];
      if (seenIds.has(id)) continue;
      const body = match[2].trim().replace(/\s+/g, ' ');
      if (body.length < 10) continue;
      seenIds.add(id);
      seenText.add(normalizeForDedup(body));
      reqs.push({ id, sourceType, sourceRef, text: body, testable: isTestable(body), ambiguous: isAmbiguous(body) });
    }
  }

  // Most real-world BRDs aren't FR-/BRD-numbered — pull requirement-bearing bullets and
  // sentences directly out of the prose instead of guessing from section headers alone.
  for (const body of extractBulletCandidates(text)) {
    pushHeuristicRequirement(reqs, seenText, counter, sourceType, sourceRef, body);
  }
  for (const body of extractSentenceCandidates(text)) {
    pushHeuristicRequirement(reqs, seenText, counter, sourceType, sourceRef, body);
  }

  // Last resort: nothing structured was found at all. Chunk by numbered section headers,
  // trimmed to a sentence boundary rather than an arbitrary mid-word cut, and flag every
  // chunk as ambiguous — we have no confidence these are clean, atomic, testable statements,
  // so surface them for review (FR-4) instead of silently feeding them to generation.
  if (reqs.length === 0) {
    const sections = text.split(/\n(?=\d+\.\d+\s)/);
    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed.length <= 30) continue;
      const cap = 800;
      let body = trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
      if (trimmed.length > cap) {
        const lastBoundary = Math.max(body.lastIndexOf('. '), body.lastIndexOf('.\n'));
        if (lastBoundary > 100) body = body.slice(0, lastBoundary + 1);
      }
      pushHeuristicRequirement(reqs, seenText, counter, sourceType, sourceRef, body, { forceAmbiguous: true });
    }
  }

  return reqs;
}

export async function parseDocument(
  buffer: Buffer,
  filename: string,
  sourceType: 'frd' | 'brd' = 'frd'
): Promise<Requirement[]> {
  const ext = path.extname(filename).toLowerCase();
  let text: string;

  if (ext === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } catch {
      throw new Error(`"${filename}" is not a readable Word document — re-export it as .docx and try again`);
    }
  } else if (ext === '.pdf') {
    try {
      const result = await pdfParse(buffer);
      text = result.text;
    } catch {
      throw new Error(`"${filename}" is not a readable PDF — check the file and try again`);
    }
  } else if (ext === '.md' || ext === '.txt') {
    text = buffer.toString('utf-8');
  } else {
    text = buffer.toString('utf-8');
  }

  return extractFrRequirements(text, sourceType, filename);
}

export function parseConfluenceContent(text: string, sourceRef: string): Requirement[] {
  return extractFrRequirements(text, 'confluence', sourceRef);
}

/** FR-1: accept an FRD/BRD as pasted text. */
export function parsePastedText(
  text: string,
  sourceType: 'frd' | 'brd' = 'frd',
  sourceRef = 'Pasted text'
): Requirement[] {
  return extractFrRequirements(text, sourceType, sourceRef);
}

export function parseJiraIssues(
  issues: Array<{ key: string; summary: string; description?: string; acceptanceCriteria?: string }>
): Requirement[] {
  return issues.map((issue) => {
    const text = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join('. ');
    return {
      id: issue.key,
      sourceType: 'jira' as const,
      sourceRef: issue.key,
      text,
      testable: text.length > 10 && isTestable(text),
      ambiguous: isAmbiguous(text),
    };
  });
}
