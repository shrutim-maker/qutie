import Anthropic from '@anthropic-ai/sdk';
import type { Requirement } from '../types.js';

const MODEL = process.env.QUTIE_AI_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
// Generous but bounded — keeps cost/latency predictable while covering realistic BRD/FRD lengths.
const MAX_INPUT_CHARS = 100000;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements'],
  properties: {
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'testable', 'ambiguous', 'confidence', 'rationale'],
        properties: {
          text: { type: 'string' },
          testable: { type: 'boolean' },
          ambiguous: { type: 'boolean' },
          confidence: { type: 'integer', description: '0-100' },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are the requirement-extraction engine inside QUTIE, Quloi's AI QA agent. You read a raw BRD/FRD/Confluence/Jira document — about ANY product or domain, you have no prior knowledge of what it will contain — and identify the small set of core INTENTS the document describes: what the feature is actually supposed to do, from the perspective of someone who has to explain it in one sentence per behavior. You are not transcribing the document, and you are not producing a checklist of every acceptance criterion, test case row, or example value it contains.

Think like a senior QA lead skimming the document to write a test charter, not like a scribe copying it line by line. A single, simple feature (e.g. a login form) has a small number of distinct behaviors — typically somewhere around 8-18. If your output looks anywhere close to the number of sentences, bullets, or table rows in the source document, you have failed this task: go back and consolidate.

CRITICAL — how to handle Test Case / Acceptance Criteria / Test Scenario tables: many documents include a table of test case IDs (TC001, TC002, ...) or a long bulleted list of example inputs, edge cases, or attack payloads. These are QA'S OWN WORKING NOTES for how they might verify things later — they are evidence of intent, not a list of separate requirements. Read the whole table/list, identify the underlying behavior(s) it is collectively checking, and produce ONE requirement per underlying behavior. For example: a block of test cases about email format, blank fields, trimming, and case sensitivity are usually all evidence of ONE requirement ("email input shall be validated"); a block about SQL injection, XSS, and other malicious payloads across multiple fields is evidence of ONE security requirement, not one per payload per field.

What counts as a requirement: a distinct, top-level behavior, business rule, or constraint that the feature must satisfy — the kind of statement you'd see as a single row in a requirements traceability matrix, not a single row in a test plan. Skip document titles, revision history, author names, table-of-contents entries, generic narrative/background, and marketing language.

For every requirement you extract:
1. text — rewrite it as ONE clear, self-contained sentence describing the expected behavior at this consolidated, intent level. Do not invent behavior, values, or constraints that are not in the document.
2. testable — true if a QA engineer could write a concrete pass/fail test case against this statement; false if it is too vague, aspirational, or non-functional to test directly (e.g. "the system should be fast").
3. ambiguous — true if the statement uses vague qualifiers ("as needed", "user-friendly", "TBD", "etc.") that leave the expected behavior underspecified.
4. confidence (0-100) — how confident you are that this is a genuine, correctly-scoped requirement actually stated in the source document (not inferred or guessed). Use 90-100 for requirements stated explicitly and unambiguously (e.g. numbered "FR-" items, explicit "must/shall" statements, or a whole cluster of test cases clearly aimed at one behavior). Use 60-89 for requirements you reconstructed from prose that clearly implies a rule. Use below 60 for anything you are inferring loosely, paraphrasing heavily, or extracting from ambiguous language.
5. rationale — one short sentence that quotes or names the specific source evidence that justifies this requirement (e.g. Section 2.3 states it "must reject empty passwords", or "consolidates test cases TC016-TC019 covering injection protection"). If you cannot point to specific wording or evidence in the document that supports it, do not include the requirement at all.

NO HALLUCINATION — this is a hard constraint: every requirement must be traceable to actual wording or evidence in the document you were given. Never invent requirements, numbers, thresholds, field names, or behavior that is not stated or unambiguously implied by the text. When in doubt, leave it out rather than guessing — a missing requirement is far better than a fabricated one.

Deduplicate near-identical requirements. Do not output more than 20 requirements for a single-feature document — if the document genuinely spans multiple independent features or modules, you may go higher, but each individual feature should still consolidate down to roughly 8-18 core requirements. If the document contains no genuine requirements, return an empty array.`;

export interface RawExtractedRequirement {
  text: string;
  testable: boolean;
  ambiguous: boolean;
  confidence: number;
  rationale: string;
}

function coerceRequirements(
  raw: RawExtractedRequirement[],
  sourceType: Requirement['sourceType'],
  sourceRef: string
): Requirement[] {
  const reqs: Requirement[] = [];
  let n = 1;
  for (const r of raw) {
    const text = r.text?.trim();
    if (!text || text.length < 10) continue;
    reqs.push({
      id: `REQ-${String(n++).padStart(3, '0')}`,
      sourceType,
      sourceRef,
      text,
      testable: !!r.testable,
      ambiguous: !!r.ambiguous,
      confidence: Math.max(0, Math.min(100, Math.round(r.confidence ?? 50))),
      rationale: r.rationale?.trim() || 'Identified by Claude as a distinct requirement in the source document.',
    });
  }
  return reqs;
}

/**
 * Extract requirements from raw document text with Claude, including a confidence score and
 * a rationale per requirement. Throws on API failure — callers fall back to pattern-based extraction.
 */
export async function extractRequirementsWithAI(
  text: string,
  sourceType: Requirement['sourceType'],
  sourceRef: string
): Promise<Requirement[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const client = new Anthropic();
  const truncated = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;
  const userPrompt = `Document source: ${sourceRef} (${sourceType.toUpperCase()})${
    trimmed.length > MAX_INPUT_CHARS ? ' — truncated to the first ' + MAX_INPUT_CHARS + ' characters' : ''
  }\n\nDocument text:\n${truncated}`;

  let message: Anthropic.Message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: userPrompt }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error('Anthropic API key is invalid — check ANTHROPIC_API_KEY in .env');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error('Anthropic API rate limit hit — retry shortly');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new Error('Could not reach the Anthropic API — check network access');
    }
    if (err instanceof Anthropic.APIError) {
      const apiMessage = (err as unknown as { error?: { error?: { message?: string } } }).error?.error?.message;
      throw new Error(apiMessage ? `Anthropic API: ${apiMessage}` : `Anthropic API error ${err.status ?? ''}: ${err.message}`);
    }
    throw err;
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('AI requirement extraction was declined by the model');
  }

  const responseText = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = JSON.parse(responseText) as { requirements: RawExtractedRequirement[] };
  return coerceRequirements(parsed.requirements ?? [], sourceType, sourceRef);
}
