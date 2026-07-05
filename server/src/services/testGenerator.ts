import type { Requirement, TestCase, TestStep } from '../types.js';

type ReqCategory =
  | 'auth'
  | 'validation'
  | 'display'
  | 'filter'
  | 'design'
  | 'form'
  | 'navigation'
  | 'permission'
  | 'generic';

interface RequirementAnalysis {
  category: ReqCategory;
  paths: string[];
  keywords: string[];
  impliesNegative: boolean;
  impliesEdge: boolean;
  impliesDesign: boolean;
}

function extractKeywords(text: string): string[] {
  const stop = new Set([
    'shall', 'must', 'will', 'should', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'user',
    'system', 'qutie', 'application', 'app', 'be', 'to', 'a', 'an', 'or', 'in', 'on', 'by', 'as', 'is', 'are',
    'not', 'any', 'all', 'only', 'can', 'may', 'into', 'via', 'using', 'provide', 'allow', 'support',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w))
    .slice(0, 6);
}

function analyzeRequirement(text: string): RequirementAnalysis {
  const lower = text.toLowerCase();
  const keywords = extractKeywords(text);

  let category: ReqCategory = 'generic';
  const paths: string[] = ['/'];

  if (/login|sign[\s-]?in|auth|credential|password|username|session/.test(lower)) {
    category = 'auth';
    paths.unshift('/login', '/signin', '/');
  } else if (/design token|colour|color|spacing|typography|font|pill|radius|token/.test(lower)) {
    category = 'design';
  } else if (/filter|search|sort|query|dropdown|select option/.test(lower)) {
    category = 'filter';
  } else if (/invalid|reject|error|fail|deny|denied|empty|required|validation|must not|cannot|should not/.test(lower)) {
    category = 'validation';
  } else if (/form|submit|input|field|enter|fill|booking|create|save/.test(lower)) {
    category = 'form';
    paths.unshift('/');
  } else if (/display|show|visible|render|present|view|dashboard|list|table|page/.test(lower)) {
    category = 'display';
  } else if (/navigate|route|redirect|link|menu|tab/.test(lower)) {
    category = 'navigation';
  } else if (/permission|role|access|authoriz|unauthorized|forbidden/.test(lower)) {
    category = 'permission';
  }

  if (/dashboard|home/.test(lower) && !paths.includes('/dashboard')) paths.unshift('/dashboard');
  if (/consolidation|shipment|order|booking/.test(lower)) {
    if (!paths.includes('/consolidation')) paths.push('/consolidation');
    if (!paths.includes('/dashboard')) paths.push('/dashboard');
  }

  return {
    category,
    paths: [...new Set(paths)],
    keywords,
    impliesNegative: /invalid|reject|error|fail|deny|must not|cannot|should not|empty|required|validation/.test(lower),
    impliesEdge: /edge|boundary|limit|maximum|minimum|zero|overflow|concurrent|duplicate/.test(lower),
    impliesDesign: category === 'design' || /design token/.test(lower),
  };
}

function inferType(text: string, variant: 'positive' | 'negative' | 'edge' | 'design'): TestCase['type'] {
  if (variant === 'design') return 'Design';
  if (variant === 'negative') return 'Negative';
  if (variant === 'edge') return 'Edge';
  if (text.toLowerCase().includes('design token')) return 'Design';
  return 'Positive';
}

function buildAuthSteps(variant: 'positive' | 'negative' | 'edge'): TestStep[] {
  if (variant === 'negative') {
    return [
      { order: 1, action: 'navigate', target: '/' },
      { order: 2, action: 'assert-visible', target: 'form, [role="form"], input:visible' },
      { order: 3, action: 'click', target: 'button[type="submit"], button:has-text("Submit"), button:has-text("Save"), button:has-text("Create"), button:has-text("Book")' },
      { order: 4, action: 'assert-visible', target: '[role="alert"], .error, .error-message, .alert-danger, .invalid' },
    ];
  }
  return [
    { order: 1, action: 'navigate', target: '/' },
    { order: 2, action: 'assert-visible', target: 'main, [role="main"], nav, h1, h2' },
    { order: 3, action: 'assert-visible', target: 'a:has-text("Log out"), button:has-text("Log out"), a:has-text("Sign out"), .user-menu, .avatar, #username, input[type="email"]' },
  ];
}

function buildValidationSteps(req: Requirement, variant: 'negative' | 'edge'): TestStep[] {
  const isEmpty = /empty|blank|missing|required/.test(req.text.toLowerCase());
  const steps: TestStep[] = [
    { order: 1, action: 'navigate', target: '/' },
    { order: 2, action: 'assert-visible', target: 'form, [role="form"], main, .card' },
  ];
  if (isEmpty || variant === 'negative') {
    steps.push(
      { order: 3, action: 'click', target: 'button[type="submit"], button:has-text("Submit"), button:has-text("Save"), button:has-text("Create"), #login-btn' },
      { order: 4, action: 'assert-visible', target: '[role="alert"], .error, .error-message, .invalid, [aria-invalid="true"]' }
    );
  } else {
    steps.push(
      { order: 3, action: 'fill', target: 'input:visible, textarea:visible', value: '___INVALID___' },
      { order: 4, action: 'click', target: 'button[type="submit"], button:has-text("Submit"), button:has-text("Save")' },
      { order: 5, action: 'assert-visible', target: '[role="alert"], .error, .error-message' }
    );
  }
  return steps;
}

function buildFormSteps(req: Requirement, variant: 'positive' | 'negative'): TestStep[] {
  if (variant === 'negative') return buildValidationSteps(req, 'negative');
  return [
    { order: 1, action: 'navigate', target: '/' },
    { order: 2, action: 'assert-visible', target: 'form, [role="form"], input:visible, textarea:visible' },
    { order: 3, action: 'assert-visible', target: 'button[type="submit"], button:has-text("Submit"), button:has-text("Save"), button:has-text("Create")' },
  ];
}

function buildFilterSteps(variant: 'positive' | 'edge'): TestStep[] {
  const steps: TestStep[] = [
    { order: 1, action: 'navigate', target: '/' },
    { order: 2, action: 'assert-visible', target: 'table, [role="grid"], [role="table"], .list, ul' },
    { order: 3, action: 'assert-visible', target: 'select, [role="combobox"], input[type="search"], input[placeholder*="filter" i], input[placeholder*="search" i]' },
  ];
  if (variant === 'edge') {
    steps.push(
      { order: 4, action: 'click', target: 'select, [role="combobox"], input[type="search"]' },
      { order: 5, action: 'assert-count', target: 'table tbody tr, [role="row"], .list-item, li', value: '0' }
    );
  } else {
    steps.push({ order: 4, action: 'click', target: 'select, [role="combobox"], input[type="search"]' });
  }
  return steps;
}

function buildDesignSteps(): TestStep[] {
  return [
    { order: 1, action: 'navigate', target: '/' },
    { order: 2, action: 'assert-visible', target: '.pill, .badge, [class*="status"], [class*="chip"]' },
    { order: 3, action: 'check-token', target: '.pill, .badge, [class*="status"], [class*="chip"]', value: '--shipped' },
  ];
}

function buildDisplaySteps(req: Requirement, analysis: RequirementAnalysis, path: string): TestStep[] {
  const steps: TestStep[] = [{ order: 1, action: 'navigate', target: path }];
  if (analysis.keywords.length > 0) {
    steps.push({
      order: 2,
      action: 'assert-page-contains',
      target: 'body',
      value: analysis.keywords.slice(0, 3).join('|'),
    });
  }
  steps.push(
    { order: steps.length + 1, action: 'assert-visible', target: 'main, [role="main"], h1, h2, .card, table, form' },
    { order: steps.length + 1, action: 'assert-visible', target: 'body' }
  );
  return steps;
}

function buildGenericSteps(analysis: RequirementAnalysis, path: string, variant: 'positive' | 'edge'): TestStep[] {
  const steps: TestStep[] = [{ order: 1, action: 'navigate', target: path }];
  if (analysis.keywords.length > 0 && variant === 'positive') {
    steps.push({
      order: 2,
      action: 'assert-page-contains',
      target: 'body',
      value: analysis.keywords.slice(0, 2).join('|'),
    });
  }
  steps.push({ order: steps.length + 1, action: 'assert-visible', target: 'main, [role="main"], h1, h2, nav, form, table, .card' });
  if (variant === 'edge') {
    steps.push({ order: steps.length + 1, action: 'assert-visible', target: 'body' });
  }
  return steps;
}

function buildStepsForRequirement(
  req: Requirement,
  analysis: RequirementAnalysis,
  variant: 'positive' | 'negative' | 'edge' | 'design'
): TestStep[] {
  const path = analysis.paths[0] ?? '/';

  if (variant === 'design' || (variant === 'positive' && analysis.impliesDesign)) {
    return buildDesignSteps();
  }

  switch (analysis.category) {
    case 'auth':
      return buildAuthSteps(variant === 'negative' ? 'negative' : 'positive');
    case 'validation':
      return buildValidationSteps(req, variant === 'edge' ? 'edge' : 'negative');
    case 'form':
      return buildFormSteps(req, variant === 'negative' ? 'negative' : 'positive');
    case 'filter':
      return buildFilterSteps(variant === 'edge' ? 'edge' : 'positive');
    case 'display':
    case 'navigation':
      return buildDisplaySteps(req, analysis, path);
    case 'permission':
      return [
        { order: 1, action: 'navigate', target: path },
        { order: 2, action: 'assert-visible', target: 'body' },
        { order: 3, action: 'assert-page-contains', target: 'body', value: 'access|permission|denied|unauthorized|forbidden' },
      ];
    default:
      return buildGenericSteps(analysis, path, variant === 'edge' ? 'edge' : 'positive');
  }
}

function expectedForVariant(req: Requirement, variant: 'positive' | 'negative' | 'edge' | 'design'): string {
  const base = req.text.trim();
  switch (variant) {
    case 'negative':
      return `Invalid or missing input is rejected with a clear error: ${base}`;
    case 'edge':
      return `Boundary or edge condition handled correctly: ${base}`;
    case 'design':
      return `UI matches design token specification: ${base}`;
    default:
      return base;
  }
}

function titleForVariant(req: Requirement, variant: 'positive' | 'negative' | 'edge' | 'design'): string {
  const snippet = req.text.slice(0, 70).trim();
  const suffix = req.text.length > 70 ? '…' : '';
  switch (variant) {
    case 'negative':
      return `[Negative] Reject invalid input — ${snippet}${suffix}`;
    case 'edge':
      return `[Edge] Boundary behavior — ${snippet}${suffix}`;
    case 'design':
      return `[Design] Token compliance — ${snippet}${suffix}`;
    default:
      return `[Positive] ${snippet}${suffix}`;
  }
}

function variantsForRequirement(analysis: RequirementAnalysis): Array<'positive' | 'negative' | 'edge' | 'design'> {
  const variants: Array<'positive' | 'negative' | 'edge' | 'design'> = ['positive'];
  if (analysis.impliesDesign) variants.push('design');
  if (analysis.impliesNegative) variants.push('negative');
  if (analysis.impliesEdge) variants.push('edge');
  return variants;
}

function generateCasesForRequirement(req: Requirement, startIndex: number, instructions: string): TestCase[] {
  const analysis = analyzeRequirement(req.text);
  const variants = variantsForRequirement(analysis);
  const cases: TestCase[] = [];

  variants.forEach((variant, vi) => {
    const id = `TC-${String(startIndex + vi + 1).padStart(3, '0')}`;
    const type = inferType(req.text, variant);
    let preconditions = 'Target application accessible and reachable';
    if (instructions) preconditions += `. Run guidance: ${instructions}`;
    if (variant === 'negative' || variant === 'edge') {
      preconditions += '. Test account may be required for authenticated flows';
    }
    if (/login/i.test(instructions) && analysis.category === 'auth') {
      preconditions += '. Prioritize login flow per run instructions';
    }

    cases.push({
      id,
      requirementId: req.id,
      title: titleForVariant(req, variant),
      type,
      preconditions,
      steps: buildStepsForRequirement(req, analysis, variant),
      testData: variant === 'negative' ? 'invalid/missing input' : variant === 'edge' ? 'boundary values' : `requirement ${req.id}`,
      expectedResult: expectedForVariant(req, variant),
      status: 'ready',
    });
  });

  return cases;
}

export function generateTestCases(requirements: Requirement[], instructions = ''): TestCase[] {
  const testable = requirements.filter((r) => r.testable && !r.ambiguous);
  const allCases: TestCase[] = [];
  let index = 0;

  for (const req of testable) {
    const cases = generateCasesForRequirement(req, index, instructions);
    allCases.push(...cases);
    index += cases.length;
  }

  return allCases;
}

export function computeCoverage(requirements: Requirement[], testCases: TestCase[]) {
  const coveredIds = new Set(testCases.map((tc) => tc.requirementId));
  const testable = requirements.filter((r) => r.testable);
  const uncovered = testable.filter((r) => !coveredIds.has(r.id));
  const pct = testable.length ? Math.round((coveredIds.size / testable.length) * 100) : 0;
  return {
    percentage: Math.min(pct, 100),
    total: testable.length,
    covered: coveredIds.size,
    uncovered: uncovered.map((r) => ({ id: r.id, text: r.text.slice(0, 100) })),
    ambiguous: requirements.filter((r) => r.ambiguous),
  };
}
