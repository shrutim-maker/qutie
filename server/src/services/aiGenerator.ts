import Anthropic from '@anthropic-ai/sdk';
import type { Requirement, TestCase, TestStep } from '../types.js';
import type { PageContext } from './pageScout.js';

const MODEL = process.env.QUTIE_AI_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
const MAX_REQUIREMENTS = 60;

const STEP_ACTIONS = [
  'navigate',
  'fill',
  'click',
  'select',
  'assert-page-contains',
  'assert-visible',
  'assert-text',
  'assert-count',
  'assert-disabled',
  'check-token',
] as const;

/** AI generation runs when Anthropic credentials are present; otherwise QUTIE falls back to templates. */
export function isAiConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['testCases'],
  properties: {
    testCases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirementId', 'title', 'type', 'preconditions', 'steps', 'testData', 'expectedResult'],
        properties: {
          requirementId: { type: 'string' },
          title: { type: 'string' },
          type: { type: 'string', enum: ['Positive', 'Negative', 'Edge', 'Design'] },
          preconditions: { type: 'string' },
          testData: { type: 'string' },
          expectedResult: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['action', 'target', 'value'],
              properties: {
                action: { type: 'string', enum: [...STEP_ACTIONS] },
                target: { type: 'string' },
                value: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are the test-case generator inside QUTIE, Quloi's AI QA agent. You turn requirement statements into executable browser test cases that a Playwright runner executes step by step.

Step actions and their exact runtime semantics:
- navigate: target is a path relative to the app base URL (e.g. "/dashboard") or a full URL. Always start each test case with a navigate step.
- fill: target is a CSS selector; value is the text to type. The placeholders {{username}} and {{password}} are substituted with the run credentials.
- click: target is a CSS selector (Playwright syntax, ":has-text()" is allowed).
- select: target is a CSS selector for a <select>; value is the option value or label.
- assert-page-contains: value is a pipe-separated list of phrases; passes if ANY phrase matches the page body (case-insensitive; words must appear in order but up to 2 extra words may sit between them, so "enter password" matches "Please enter your password"). Use 2-4 alternatives to make intent checks robust.
- assert-visible: target is a CSS selector; passes if at least one match is visible. Comma-separated selector alternatives are allowed.
- assert-text: target is a CSS selector; value must appear in its text content.
- assert-count: target is a CSS selector; value is the exact expected match count.
- assert-disabled: target is a CSS selector; passes if the first match is disabled.
- check-token: target is a CSS selector for a status pill/badge; value is a design token name (default "--shipped"). Use only for design-token compliance requirements.

Rules:
1. Session handling: the runner logs in once before the suite. Any test case whose FIRST navigate targets a login path (/login, /signin, ...) automatically runs in a fresh logged-out browser session, so the login form WILL be present — use this for authentication requirements (form rendering, invalid credentials, blank password, valid login). All other test cases run in the authenticated session. If a test logs the user out, the runner re-authenticates before the next test.
2. Generate 1-3 test cases per requirement: always a positive case; add negative/edge/design cases only where the requirement implies them.
3. When page context (real DOM digests) is provided, use selectors and paths that actually exist in it. Prefer IDs and names over text matching. Do not invent selectors that are not plausible for the described app.
4. When no page context is provided, use robust generic selectors (semantic elements, roles, broad comma-separated alternatives) and assert-page-contains for intent checks.
5. Prefer shallow, reliable assertions over deep multi-page flows the runner cannot sustain. Each test case should have 2-6 steps.
5b. Actions like Logout, Profile, or Settings usually live inside an avatar/user menu in SPAs. If the page context does not show a directly visible button for them, first click the menu trigger (avatar, user name, or profile button visible in the page context), then click the action. If the page context gives no evidence of where such an action lives, prefer asserting its visible effects instead of guessing selectors.
5c. Never navigate to invented paths. Only navigate to: the login path, "/", or paths that appear in the page context (links/urls). SPAs have no /logout, /settings, etc. routes — performing those actions requires clicking UI elements, not navigation.
6. Keep titles short and prefixed with the case type, e.g. "[Negative] Booking rejects empty destination".
7. preconditions and testData are short human-readable strings. expectedResult states the observable outcome.
8. For steps where target or value is not applicable, use an empty string.`;

export interface RawTestCase {
  requirementId: string;
  title: string;
  type: string;
  preconditions: string;
  testData: string;
  expectedResult: string;
  steps: Array<{ action: string; target: string; value: string }>;
}

export function coerceTestCases(raw: RawTestCase[], requirements: Requirement[]): TestCase[] {
  const validReqIds = new Set(requirements.map((r) => r.id));
  const allowedActions = new Set<string>(STEP_ACTIONS);
  const cases: TestCase[] = [];

  for (const tc of raw) {
    if (!validReqIds.has(tc.requirementId)) continue;
    if (!tc.title || !tc.expectedResult) continue;

    const steps: TestStep[] = (tc.steps ?? [])
      .filter((s) => allowedActions.has(s.action))
      .map((s, i) => ({
        order: i + 1,
        action: s.action,
        target: s.target || undefined,
        value: s.value || undefined,
      }));
    if (!steps.length) continue;
    if (steps[0].action !== 'navigate') {
      steps.unshift({ order: 0, action: 'navigate', target: '/' });
      steps.forEach((s, i) => (s.order = i + 1));
    }

    cases.push({
      id: `TC-${String(cases.length + 1).padStart(3, '0')}`,
      requirementId: tc.requirementId,
      title: tc.title.slice(0, 140),
      type: (['Positive', 'Negative', 'Edge', 'Design'] as const).includes(tc.type as never)
        ? (tc.type as TestCase['type'])
        : 'Positive',
      preconditions: tc.preconditions || 'Target application accessible and reachable',
      steps,
      testData: tc.testData || `requirement ${tc.requirementId}`,
      expectedResult: tc.expectedResult,
      status: 'ready',
    });
  }

  return cases;
}

function buildUserPrompt(requirements: Requirement[], instructions: string, pageContext?: PageContext): string {
  const reqs = requirements.slice(0, MAX_REQUIREMENTS);
  const parts: string[] = [];

  parts.push('Requirements to cover (generate test cases for every one):');
  parts.push(
    JSON.stringify(
      reqs.map((r) => ({ id: r.id, source: r.sourceType, text: r.text.slice(0, 400) })),
      null,
      1
    )
  );

  if (pageContext) {
    parts.push('\nPage context — real DOM digests captured from the target app (use these selectors and paths):');
    parts.push(JSON.stringify(pageContext, null, 1).slice(0, 24000));
  } else {
    parts.push('\nNo page context available — use robust generic selectors.');
  }

  if (instructions) {
    parts.push(`\nRun instructions from the user (guides emphasis, not requirements): ${instructions.slice(0, 1000)}`);
  }

  return parts.join('\n');
}

/**
 * Generate test cases with Claude. Throws on API failure — callers fall back to
 * the heuristic template generator.
 */
export async function generateTestCasesWithAI(
  requirements: Requirement[],
  instructions = '',
  pageContext?: PageContext
): Promise<TestCase[]> {
  const client = new Anthropic();
  const testable = requirements.filter((r) => r.testable && !r.ambiguous);
  if (!testable.length) return [];

  let message: Anthropic.Message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: {
        // Medium effort: this is a well-specified schema-constrained transformation, not an
        // open-ended task — lower effort keeps output literal and consistent run-to-run.
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: buildUserPrompt(testable, instructions, pageContext) }],
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
      // The SDK's own .message is "400 {...raw json envelope...}" — the human-readable
      // message is nested at err.error.error.message, so pull that out for the UI.
      const apiMessage = (err as unknown as { error?: { error?: { message?: string } } }).error?.error?.message;
      throw new Error(apiMessage ? `Anthropic API: ${apiMessage}` : `Anthropic API error ${err.status ?? ''}: ${err.message}`);
    }
    throw err;
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('AI generation was declined by the model');
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = JSON.parse(text) as { testCases: RawTestCase[] };
  const cases = coerceTestCases(parsed.testCases ?? [], testable);
  if (!cases.length) {
    throw new Error('AI generation returned no usable test cases');
  }
  return cases;
}
