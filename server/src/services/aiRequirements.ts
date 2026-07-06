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

const SYSTEM_PROMPT = `You are the requirement-extraction engine inside QUTIE, Quloi's AI QA agent. You read a raw BRD/FRD/Confluence/Jira document — about ANY product or domain, you have no prior knowledge of what it will contain — and pull out the real requirements it describes, the way an experienced business analyst would list them on a requirements traceability matrix. This is not a copy of every sentence, and it is not a breakdown into individual test-case variations.

What counts as a requirement: a statement describing expected system/product behavior, a business rule, a validation rule, an acceptance criterion, or a constraint — written at the granularity a BA would actually list it, not the granularity a tester would enumerate test data for. Skip document titles, revision history, author names, table-of-contents entries, generic narrative/background, and marketing language.

GRANULARITY — this is the most common mistake, avoid it: if the document describes ONE rule applied across several fields, inputs, or attack types (e.g. "the system must sanitize input against SQL injection and XSS in the email and password fields", or a "Test Scenarios" / "Edge Cases" section listing many example inputs for the same field), extract ONE requirement covering that rule ("Login input fields shall be sanitized against injection attacks such as SQL injection and XSS"). Do NOT create a separate requirement per field, per payload, or per example — that produces a bloated, nonsensical requirement list. Only split into separate requirements when the document itself gives them distinct identifiers (FR-1, FR-2, BR-01...) or they are clearly independent rules governing different behavior. A well-formed BRD/FRD for a single feature typically yields well under 30 requirements; if you are extracting far more than that, you are almost certainly over-splitting — go back and merge.

For every requirement you extract:
1. text — rewrite it as ONE clear, self-contained sentence describing the expected behavior, scoped at BA-level granularity as described above. Do not invent behavior, values, or constraints that are not in the document.
2. testable — true if a QA engineer could write a concrete pass/fail test case against this statement; false if it is too vague, aspirational, or non-functional to test directly (e.g. "the system should be fast").
3. ambiguous — true if the statement uses vague qualifiers ("as needed", "user-friendly", "TBD", "etc.") that leave the expected behavior underspecified.
4. confidence (0-100) — how confident you are that this is a genuine, correctly-scoped requirement actually stated in the source document (not inferred or guessed). Use 90-100 for requirements stated explicitly and unambiguously (e.g. numbered "FR-" items, explicit "must/shall" statements). Use 60-89 for requirements you reconstructed from prose that clearly implies a rule. Use below 60 for anything you are inferring loosely, paraphrasing heavily, or extracting from ambiguous language.
5. rationale — one short sentence that quotes the specific source wording that justifies this requirement (e.g. Section 2.3 states it "must reject empty passwords"). If you cannot point to specific wording in the document that supports it, do not include the requirement at all.

NO HALLUCINATION — this is a hard constraint: every requirement must be traceable to actual wording in the document you were given. Never invent requirements, numbers, thresholds, field names, or behavior that is not stated or unambiguously implied by the text. When in doubt, leave it out rather than guessing — a missing requirement is far better than a fabricated one.

Deduplicate near-identical requirements. Do not output more than 40 requirements — if the document has more distinct rules than that, keep the most concrete and testable ones and merge the rest under broader rules as described above. If the document contains no genuine requirements, return an empty array.`;

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
