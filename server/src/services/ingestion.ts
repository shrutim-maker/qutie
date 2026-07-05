import mammoth from 'mammoth';
import path from 'path';
import type { Requirement } from '../types.js';

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

function isAmbiguous(text: string): boolean {
  return AMBIGUOUS_PATTERNS.some((p) => p.test(text));
}

function isTestable(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('pluggable') || lower.includes('extensibility')) return false;
  if (lower.includes('auditability') && lower.includes('logged')) return false;
  return !isAmbiguous(text);
}

function extractFrRequirements(
  text: string,
  sourceType: 'frd' | 'brd' | 'confluence',
  sourceRef: string
): Requirement[] {
  const reqs: Requirement[] = [];
  const seen = new Set<string>();

  // Match "FR-1 QUTIE shall ..." style
  let match: RegExpExecArray | null;
  const combined = new RegExp(FR_PATTERN.source, 'gis');
  while ((match = combined.exec(text)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const body = match[2].trim().replace(/\s+/g, ' ');
    reqs.push({
      id,
      sourceType,
      sourceRef,
      text: body,
      testable: isTestable(body),
      ambiguous: isAmbiguous(body),
    });
  }

  // Fallback: line-by-line FR-XX
  const lineRe = new RegExp(FR_LINE_PATTERN.source, 'gim');
  while ((match = lineRe.exec(text)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const body = match[2].trim().replace(/\s+/g, ' ');
    if (body.length < 10) continue;
    reqs.push({
      id,
      sourceType,
      sourceRef,
      text: body,
      testable: isTestable(body),
      ambiguous: isAmbiguous(body),
    });
  }

  // Section-based fallback for numbered requirements
  if (reqs.length === 0) {
    const sections = text.split(/\n(?=\d+\.\d+\s)/);
    sections.forEach((section, i) => {
      const id = `REQ-${String(i + 1).padStart(3, '0')}`;
      const body = section.trim().slice(0, 500);
      if (body.length > 30) {
        reqs.push({
          id,
          sourceType,
          sourceRef,
          text: body,
          testable: isTestable(body),
          ambiguous: isAmbiguous(body),
        });
      }
    });
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
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
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
