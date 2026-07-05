import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { StepEvidence, TestCase, TestResult, TestStep } from '../types.js';
import { checkDesignToken } from './designTokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(__dirname, '..', '..', 'data', 'evidence');

if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

/** Hostname patterns treated as production (FR-17). Staging/dev hosts are excluded. */
const PRODUCTION_HOST_PATTERNS = [
  /^prod[\w-]*\.quloi/i,
  /^app\.quloi\.com$/i,
  /\.quloi\.com$/i,
];

/** Staging/dev hostnames — checked before *.quloi.com production rules (FR-17). */
const STAGING_HOST_HINTS =
  /^(staging|dev|qa|uat|sandbox|test|local|demo)|[-](dev|staging|qa|uat|sandbox|test)(\.|$)|\.(staging|dev|qa|uat|sandbox|test)\./i;

const LOGIN_URL_HINTS = /\/(login|signin|sign-in|auth|account\/login|users\/sign_in)(\/|$|\?)/i;

export function normalizeTargetUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** App origin for relative paths — strips trailing login path when Product URL is the login page. */
export function resolveAppBaseUrl(url: string): string {
  try {
    const parsed = new URL(normalizeTargetUrl(url));
    if (LOGIN_URL_HINTS.test(parsed.pathname)) {
      return parsed.origin;
    }
    return parsed.href.endsWith('/') ? parsed.href.slice(0, -1) : parsed.href;
  } catch {
    return normalizeTargetUrl(url);
  }
}

/** Resolve Login URL field: full URL, path (/login), or host-relative against Product URL. */
export function resolveLoginUrl(loginUrl: string, targetUrl: string): string {
  const trimmed = loginUrl.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = resolveAppBaseUrl(targetUrl);
  if (trimmed.startsWith('/')) return new URL(trimmed, `${base}/`).href;
  return normalizeTargetUrl(trimmed);
}

export interface ProductionUrlCheck {
  blocked: boolean;
  isProduction: boolean;
  warning?: string;
  hostname?: string;
}

export function checkProductionUrl(url: string): ProductionUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(normalizeTargetUrl(url));
  } catch {
    return { blocked: false, isProduction: false };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || STAGING_HOST_HINTS.test(hostname)) {
    return { blocked: false, isProduction: false, hostname };
  }

  const isProduction = PRODUCTION_HOST_PATTERNS.some((p) => p.test(hostname));
  if (!isProduction) return { blocked: false, isProduction: false, hostname };

  const allowed = process.env.ALLOW_PRODUCTION_URL === 'true';
  if (allowed) {
    return {
      blocked: false,
      isProduction: true,
      hostname,
      warning: `Running against production host "${hostname}" (ALLOW_PRODUCTION_URL=true). Destructive actions are still avoided.`,
    };
  }

  return {
    blocked: true,
    isProduction: true,
    hostname,
  };
}

/** @deprecated Use checkProductionUrl — kept for callers that only need a boolean. */
export function isProductionUrl(url: string): boolean {
  return checkProductionUrl(url).isProduction;
}

function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const s of secrets) {
    if (s && s.length > 2) {
      result = result.split(s).join('***REDACTED***');
    }
  }
  return result;
}

function evidencePublicUrl(runId: string, testCaseId: string, stepIndex: number): string {
  return `/evidence/${runId}/${testCaseId}/step-${stepIndex}.png`;
}

/** Blur password and filled credential fields before capturing screenshots. */
async function redactSensitiveFields(page: PlaywrightPage): Promise<void> {
  await page
    .evaluate(() => {
      const blur = (el: Element) => {
        const html = el as HTMLElement;
        html.style.filter = 'blur(10px)';
        html.style.background = '#ccc';
      };
      document.querySelectorAll('input[type="password"]').forEach(blur);
      document.querySelectorAll('input[autocomplete*="password" i]').forEach(blur);
      document.querySelectorAll('input[type="email"], input[name*="email" i], input[name*="user" i]').forEach((el) => {
        const input = el as HTMLInputElement;
        if (input.value) blur(el);
      });
    })
    .catch(() => {});
}

async function captureStepScreenshot(
  page: PlaywrightPage,
  runId: string,
  testCaseId: string,
  stepIndex: number
): Promise<string> {
  const dir = path.join(evidenceDir, runId, testCaseId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `step-${stepIndex}.png`);
  await redactSensitiveFields(page);
  await page.screenshot({ path: filePath, fullPage: false }).catch(() => {});
  return evidencePublicUrl(runId, testCaseId, stepIndex);
}

function describeStep(step: TestStep, baseUrl: string): string {
  switch (step.action) {
    case 'navigate': {
      const url = step.target?.startsWith('http')
        ? step.target
        : new URL(step.target ?? '/', `${baseUrl}/`).href;
      return `Navigating to ${url}`;
    }
    case 'fill':
      return `Filling ${step.target ?? 'field'}`;
    case 'click':
      return `Clicking ${step.target ?? 'element'}`;
    case 'select':
      return `Selecting ${step.value ?? 'option'} in ${step.target ?? 'dropdown'}`;
    case 'assert-page-contains':
      return `Asserting page contains "${step.value ?? ''}"`;
    case 'assert-visible':
      return `Asserting visible: ${step.target ?? ''}`;
    case 'assert-text':
      return `Asserting text "${step.value ?? ''}" in ${step.target ?? ''}`;
    case 'assert-count':
      return `Asserting count ${step.value ?? ''} for ${step.target ?? ''}`;
    case 'assert-disabled':
      return `Asserting disabled: ${step.target ?? ''}`;
    case 'check-token':
      return `Checking design token on ${step.target ?? ''}`;
    default:
      return step.action;
  }
}

async function recordEvidence(
  ctx: EvidenceContext,
  page: PlaywrightPage,
  testCaseId: string,
  testCaseTitle: string | undefined,
  action: string,
  description: string,
  status: 'pass' | 'fail' | 'running'
): Promise<StepEvidence | undefined> {
  if (!ctx.verbose) return undefined;

  const stepIndex = ctx.globalStepIndex++;
  const screenshotUrl = await captureStepScreenshot(page, ctx.runId, testCaseId, stepIndex);
  const progressStatus = status === 'pass' ? 'complete' : status === 'fail' ? 'fail' : 'running';

  const evidence: StepEvidence = {
    stepIndex,
    action,
    screenshotUrl,
    timestamp: new Date().toISOString(),
    status,
    description,
  };

  if (ctx.progress) {
    ctx.progress.onStep({
      stepIndex,
      action,
      description,
      screenshotUrl,
      status: progressStatus,
      testCaseId,
      testCaseTitle,
    });
  }

  return evidence;
}

export interface ProgressReporter {
  runId: string;
  totalSteps: number;
  onStep: (step: {
    stepIndex: number;
    action: string;
    description: string;
    screenshotUrl?: string;
    status: 'running' | 'complete' | 'fail';
    testCaseId?: string;
    testCaseTitle?: string;
  }) => void;
}

interface ExecuteOptions {
  targetUrl: string;
  loginUrl?: string;
  username: string;
  password: string;
  testCases: TestCase[];
  retryCount?: number;
  verboseEvidence?: boolean;
  brokenMode?: boolean;
  instructions?: string;
  runId?: string;
  progress?: ProgressReporter;
}

interface EvidenceContext {
  runId: string;
  secrets: string[];
  verbose: boolean;
  globalStepIndex: number;
  progress?: ProgressReporter;
}

const LOGIN_CASE_ID = '__login__';

export interface ExecuteSuiteResult {
  results: TestResult[];
  designCompliance: number;
  violations: number;
  authNote?: string;
  loginDebug?: string[];
  productionWarning?: string;
}

export interface LoginAttemptResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
  debug: string[];
  resolvedLoginUrl?: string;
}

const LOGIN_PATHS = [
  '/login',
  '/signin',
  '/sign-in',
  '/auth/login',
  '/auth/signin',
  '/account/login',
  '/users/sign_in',
  '/user/login',
];

const EMAIL_SELECTORS = [
  '#username',
  '#email',
  '#user_email',
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  'input[name*="email" i]',
  'input[name*="user" i]',
  'input[id*="email" i]',
  'input[id*="user" i]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[placeholder*="mail" i]',
  'input[placeholder*="user" i]',
  'input[placeholder*="login" i]',
];

const PASSWORD_SELECTORS = [
  '#password',
  'input[type="password"]',
  'input[name="password"]',
  'input[name*="password" i]',
  'input[id*="password" i]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="password"]',
  'input[placeholder*="password" i]',
];

const SUBMIT_SELECTORS = [
  '#login-btn',
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Submit")',
];

const CONTINUE_SELECTORS = [
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
];

const SIGN_IN_ENTRY_SELECTORS = [
  'a:has-text("Sign in")',
  'a:has-text("Log in")',
  'a:has-text("Login")',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  '[href*="login" i]',
  '[href*="signin" i]',
  '[href*="sign-in" i]',
];

const COOKIE_DISMISS_SELECTORS = [
  '#onetrust-accept-btn-handler',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  'button:has-text("Allow all")',
  'button:has-text("Allow All")',
  'button:has-text("OK")',
  '[data-testid*="accept" i]',
  '[aria-label*="accept" i]',
  '.osano-cm-accept-all',
];

const LOGIN_ERROR_SELECTORS = [
  '.error.show',
  '.error-message',
  '[role="alert"]',
  '.alert-danger',
  '.alert-error',
  '[class*="error" i]',
  '[data-testid*="error" i]',
];

const LOGOUT_INDICATORS = [
  'a:has-text("Log out")',
  'a:has-text("Sign out")',
  'button:has-text("Log out")',
  'button:has-text("Sign out")',
  '[href*="logout" i]',
  '[href*="signout" i]',
  '[href*="sign-out" i]',
  '[data-testid*="logout" i]',
  '[data-testid*="profile" i]',
  '.user-menu',
  '.avatar',
];

type PlaywrightPage = import('playwright').Page;
type PlaywrightLocator = import('playwright').Locator;

async function isVisible(loc: PlaywrightLocator): Promise<boolean> {
  return (await loc.count()) > 0 && (await loc.isVisible().catch(() => false));
}

async function findVisibleLocator(
  root: PlaywrightPage | import('playwright').Frame,
  selectors: string[]
): Promise<PlaywrightLocator | null> {
  for (const sel of selectors) {
    const loc = root.locator(sel).first();
    if (await isVisible(loc)) return loc;
  }
  return null;
}

async function findEmailField(root: PlaywrightPage | import('playwright').Frame): Promise<PlaywrightLocator | null> {
  const bySelector = await findVisibleLocator(root, EMAIL_SELECTORS);
  if (bySelector) return bySelector;

  const labelPatterns = [/email/i, /username/i, /user\s*name/i, /login/i];
  for (const pattern of labelPatterns) {
    const byLabel = root.getByLabel(pattern).first();
    if (await isVisible(byLabel)) return byLabel;
    const byPlaceholder = root.getByPlaceholder(pattern).first();
    if (await isVisible(byPlaceholder)) return byPlaceholder;
    const byRole = root.getByRole('textbox', { name: pattern }).first();
    if (await isVisible(byRole)) return byRole;
  }
  return null;
}

async function findPasswordField(root: PlaywrightPage | import('playwright').Frame): Promise<PlaywrightLocator | null> {
  const bySelector = await findVisibleLocator(root, PASSWORD_SELECTORS);
  if (bySelector) return bySelector;

  const byLabel = root.getByLabel(/password/i).first();
  if (await isVisible(byLabel)) return byLabel;
  const byPlaceholder = root.getByPlaceholder(/password/i).first();
  if (await isVisible(byPlaceholder)) return byPlaceholder;
  return null;
}

async function findInPageOrFrames(
  page: PlaywrightPage,
  finder: (root: PlaywrightPage | import('playwright').Frame) => Promise<PlaywrightLocator | null>
): Promise<PlaywrightLocator | null> {
  const onPage = await finder(page);
  if (onPage) return onPage;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const inFrame = await finder(frame);
    if (inFrame) return inFrame;
  }
  return null;
}

interface LoginFormState {
  emailField: PlaywrightLocator | null;
  passwordField: PlaywrightLocator | null;
  inFrame: boolean;
}

async function detectLoginForm(page: PlaywrightPage): Promise<LoginFormState> {
  const emailField = await findInPageOrFrames(page, findEmailField);
  const passwordField = await findInPageOrFrames(page, findPasswordField);
  return { emailField, passwordField, inFrame: false };
}

async function waitForSpaHydration(page: PlaywrightPage, debug: string[]): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.locator('#root input, form input, input[type="email"], input[type="password"]')
    .first()
    .waitFor({ state: 'visible', timeout: 12000 })
    .catch(() => {});
  debug.push('Waited for SPA/login form hydration');
}

async function waitForLoginForm(page: PlaywrightPage, debug: string[]): Promise<LoginFormState> {
  let form = await detectLoginForm(page);
  if (form.emailField || form.passwordField) return form;

  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    form = await detectLoginForm(page);
    if (form.emailField || form.passwordField) {
      debug.push('Login form appeared after SPA render');
      return form;
    }
  }
  debug.push('Login form not visible after waiting — page may require SSO or a different Login URL');
  return form;
}

async function dismissCookieBanners(page: PlaywrightPage, debug: string[]): Promise<void> {
  for (const sel of COOKIE_DISMISS_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await isVisible(btn)) {
      await btn.click().catch(() => {});
      debug.push(`Dismissed cookie/consent banner (${sel})`);
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function clickSignInEntryPoint(page: PlaywrightPage, debug: string[]): Promise<boolean> {
  for (const sel of SIGN_IN_ENTRY_SELECTORS) {
    const link = page.locator(sel).first();
    if (await isVisible(link)) {
      debug.push(`Clicked sign-in entry point (${sel})`);
      await link.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

/** Fill inputs that may be readonly/disabled (common on SPA login pages like omni-dev). */
async function safeFill(loc: PlaywrightLocator, value: string, debug: string[]): Promise<void> {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 5000 }).catch(() => {});

  try {
    await loc.fill(value, { timeout: 12000 });
    debug.push('Filled field via standard fill');
    return;
  } catch {
    debug.push('Standard fill failed — trying readonly/disabled workaround');
  }

  try {
    await loc.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.removeAttribute('readonly');
      input.removeAttribute('disabled');
      input.readOnly = false;
      input.disabled = false;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    debug.push('Set field value via DOM (readonly/disabled workaround)');
    return;
  } catch {
    /* fall through */
  }

  await loc.fill(value, { force: true, timeout: 12000 });
  debug.push('Filled field with force:true');
}

async function clickSubmit(
  page: PlaywrightPage,
  preferContinue = false
): Promise<string | null> {
  const selectors = preferContinue ? CONTINUE_SELECTORS : SUBMIT_SELECTORS;
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await isVisible(btn)) {
      await btn.click();
      return sel;
    }
  }
  return null;
}

async function readLoginError(page: PlaywrightPage): Promise<string | undefined> {
  for (const sel of LOGIN_ERROR_SELECTORS) {
    const errEl = page.locator(sel).first();
    if ((await errEl.count()) > 0 && (await errEl.isVisible().catch(() => false))) {
      const text = (await errEl.textContent())?.trim();
      if (text && text.length > 2 && text.length < 300) return text;
    }
  }
  return undefined;
}

async function hasLogoutIndicator(page: PlaywrightPage): Promise<boolean> {
  for (const sel of LOGOUT_INDICATORS) {
    const el = page.locator(sel).first();
    if (await isVisible(el)) return true;
  }
  return false;
}

async function evaluateLoginOutcome(
  page: PlaywrightPage,
  startUrl: string,
  debug: string[]
): Promise<Pick<LoginAttemptResult, 'success' | 'error'>> {
  const currentUrl = page.url();
  const form = await detectLoginForm(page);
  const onLoginUrl = LOGIN_URL_HINTS.test(currentUrl);
  const hasLogout = await hasLogoutIndicator(page);
  const errText = await readLoginError(page);

  if (hasLogout) {
    debug.push('Login success: logout/profile element detected');
    return { success: true };
  }

  if (errText) {
    debug.push(`Login error message: ${errText}`);
    return { success: false, error: `Login failed: ${errText}` };
  }

  const bothFieldsVisible = form.emailField !== null && form.passwordField !== null;
  if (bothFieldsVisible && onLoginUrl) {
    debug.push('Login form still visible on login URL after submit');
    return { success: false, error: 'Login form still visible — check credentials or login flow' };
  }

  if (bothFieldsVisible && currentUrl === startUrl) {
    debug.push('Login form still visible at starting URL');
    return { success: false, error: 'Login form still visible after submit — check credentials or selectors' };
  }

  if (!onLoginUrl && currentUrl !== startUrl) {
    debug.push(`URL changed from login page to ${currentUrl}`);
    return { success: true };
  }

  if (!bothFieldsVisible && !onLoginUrl) {
    debug.push('Password/email fields gone and not on login URL — assuming success');
    return { success: true };
  }

  if (form.passwordField && !form.emailField && !onLoginUrl) {
    debug.push('Only password field context cleared — assuming success');
    return { success: true };
  }

  debug.push(`Uncertain login state (url=${currentUrl})`);
  return { success: false, error: 'Could not confirm login success — form may still be present or SSO required' };
}

async function fillAndSubmitLogin(
  page: PlaywrightPage,
  creds: { username: string; password: string },
  debug: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    let form = await detectLoginForm(page);

    if (!form.emailField && !form.passwordField) {
      return { success: false, error: 'No login fields found to fill' };
    }

    if (form.emailField && !form.passwordField) {
      debug.push('Multi-step login: email field only — filling email');
      await safeFill(form.emailField, creds.username, debug);
      const clicked = await clickSubmit(page, true);
      if (clicked) {
        debug.push(`Clicked continue/submit (${clicked})`);
      } else {
        await form.emailField.press('Enter');
        debug.push('Pressed Enter on email field');
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      form = await detectLoginForm(page);
    }

    if (form.emailField) {
      await safeFill(form.emailField, creds.username, debug);
      debug.push('Filled email/username field');
    }

    if (!form.passwordField) {
      form.passwordField = await findInPageOrFrames(page, findPasswordField);
    }

    if (!form.passwordField) {
      return { success: false, error: 'Password field not found (multi-step login may need a custom Login URL)' };
    }

    await safeFill(form.passwordField, creds.password, debug);
    debug.push('Filled password field');

    const submitSel = await clickSubmit(page);
    if (submitSel) {
      debug.push(`Clicked submit (${submitSel})`);
    } else {
      await form.passwordField.press('Enter');
      debug.push('Pressed Enter on password field');
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debug.push(`Login fill error: ${msg}`);
    return {
      success: false,
      error: msg.includes('not editable') || msg.includes('readonly')
        ? 'Login email field is read-only — the page may require a prior step or a different Login URL'
        : `Login form interaction failed: ${msg}`,
    };
  }
}

/** FR-12: authenticate once before the suite when credentials are supplied. */
export async function attemptLogin(
  page: PlaywrightPage,
  targetUrl: string,
  creds: { username: string; password: string },
  options?: { loginUrl?: string; evidence?: EvidenceContext }
): Promise<LoginAttemptResult> {
  const debug: string[] = [];
  const evidence = options?.evidence;
  const loginEvidence: StepEvidence[] = [];
  const normalizedTarget = normalizeTargetUrl(targetUrl);
  const appBase = resolveAppBaseUrl(normalizedTarget);
  const targetIsLoginPage = LOGIN_URL_HINTS.test(new URL(normalizedTarget).pathname);

  const explicitLoginUrl = options?.loginUrl?.trim()
    ? resolveLoginUrl(options.loginUrl, normalizedTarget)
    : undefined;
  let resolvedLoginUrl = explicitLoginUrl ?? (targetIsLoginPage ? normalizedTarget : appBase);

  debug.push(`Target URL: ${normalizedTarget}`);
  debug.push(`App base: ${appBase}`);
  if (explicitLoginUrl) debug.push(`Explicit login URL: ${explicitLoginUrl}`);
  if (targetIsLoginPage && !explicitLoginUrl) debug.push('Product URL is a login page — using it directly');

  if (!creds.username && !creds.password) {
    try {
      debug.push(`Navigating to ${resolvedLoginUrl} (no credentials — skipping login)`);
      await page.goto(resolvedLoginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await waitForSpaHydration(page, debug);
      if (evidence) {
        const ev = await recordEvidence(evidence, page, LOGIN_CASE_ID, 'Login', 'navigate', `Navigated to ${resolvedLoginUrl} (no credentials)`, 'pass');
        if (ev) loginEvidence.push(ev);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Could not reach ${resolvedLoginUrl}: ${msg}. Check URL, VPN, or set IGNORE_HTTPS_ERRORS=true for cert issues.`,
        debug,
        resolvedLoginUrl,
      };
    }
    return { success: true, skipped: true, debug, resolvedLoginUrl };
  }

  try {
    debug.push(`Navigating to ${resolvedLoginUrl}`);
    await page.goto(resolvedLoginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForSpaHydration(page, debug);
    if (evidence) {
      const ev = await recordEvidence(evidence, page, LOGIN_CASE_ID, 'Login', 'navigate', `Navigating to ${resolvedLoginUrl}`, 'running');
      if (ev) loginEvidence.push(ev);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Could not reach ${resolvedLoginUrl}: ${msg}. Check URL, VPN, or set IGNORE_HTTPS_ERRORS=true for cert issues.`,
      debug,
      resolvedLoginUrl,
    };
  }

  await dismissCookieBanners(page, debug);
  let form = await waitForLoginForm(page, debug);

  if (!form.emailField && !form.passwordField) {
    debug.push('No login form on initial page — trying sign-in entry points');
    const clicked = await clickSignInEntryPoint(page, debug);
    if (clicked) {
      await dismissCookieBanners(page, debug);
      form = await waitForLoginForm(page, debug);
    }
  }

  if (!form.emailField && !form.passwordField && !explicitLoginUrl && !targetIsLoginPage) {
    debug.push('Trying common login paths');
    for (const loginPath of LOGIN_PATHS) {
      const candidate = new URL(loginPath, `${appBase}/`).href;
      if (candidate === resolvedLoginUrl) continue;
      try {
        await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await waitForSpaHydration(page, debug);
        await dismissCookieBanners(page, debug);
        form = await waitForLoginForm(page, debug);
        if (form.emailField || form.passwordField) {
          resolvedLoginUrl = candidate;
          debug.push(`Found login form at ${candidate}`);
          break;
        }
      } catch {
        debug.push(`Could not load ${candidate}`);
      }
    }
  }

  if (!form.emailField && !form.passwordField) {
    const ssoHint = page.locator('button:has-text("Google"), button:has-text("Microsoft"), a:has-text("Google"), a:has-text("Microsoft")').first();
    if (await isVisible(ssoHint)) {
      debug.push('SSO buttons detected (Google/Microsoft) — automated login not supported for OAuth flows');
      return {
        success: false,
        error: 'SSO/OAuth login detected — provide a direct username/password login URL or use a test account bypass',
        debug,
        resolvedLoginUrl,
      };
    }
    const pageTitle = await page.title().catch(() => '');
    return {
      success: false,
      error: `No login form found at ${resolvedLoginUrl}${pageTitle ? ` (${pageTitle})` : ''} — set Login URL if sign-in is elsewhere, or wait for React/SPA to finish loading`,
      debug,
      resolvedLoginUrl,
    };
  }

  debug.push(
    `Login form detected (email=${form.emailField ? 'yes' : 'no'}, password=${form.passwordField ? 'yes' : 'no'})`
  );

  if (evidence) {
    const ev = await recordEvidence(evidence, page, LOGIN_CASE_ID, 'Login', 'detect-form', 'Login form detected', 'running');
    if (ev) loginEvidence.push(ev);
  }

  const fillResult = await fillAndSubmitLogin(page, creds, debug);
  if (!fillResult.success) {
    if (evidence) {
      const ev = await recordEvidence(
        evidence,
        page,
        LOGIN_CASE_ID,
        'Login',
        'login-fail',
        redactSecrets(fillResult.error ?? 'Login failed', evidence.secrets),
        'fail'
      );
      if (ev) loginEvidence.push(ev);
    }
    return { success: false, error: fillResult.error, debug, resolvedLoginUrl };
  }

  if (evidence) {
    const ev = await recordEvidence(evidence, page, LOGIN_CASE_ID, 'Login', 'submit-login', 'Submitted login credentials', 'running');
    if (ev) loginEvidence.push(ev);
  }

  const outcome = await evaluateLoginOutcome(page, resolvedLoginUrl, debug);
  if (evidence) {
    const ev = await recordEvidence(
      evidence,
      page,
      LOGIN_CASE_ID,
      'Login',
      'login-outcome',
      outcome.success ? 'Login succeeded' : redactSecrets(outcome.error ?? 'Login failed', evidence.secrets),
      outcome.success ? 'pass' : 'fail'
    );
    if (ev) loginEvidence.push(ev);
  }
  return { ...outcome, debug, resolvedLoginUrl };
}

export async function executeTestSuite(options: ExecuteOptions): Promise<ExecuteSuiteResult> {
  const {
    targetUrl,
    loginUrl,
    username,
    password,
    testCases,
    retryCount = 1,
    brokenMode,
    runId = `run-${Date.now()}`,
    verboseEvidence = true,
    progress,
  } = options;
  const normalizedUrl = normalizeTargetUrl(targetUrl);
  const appBaseUrl = resolveAppBaseUrl(normalizedUrl);

  const prodCheck = checkProductionUrl(normalizedUrl);
  if (prodCheck.blocked) {
    const hint =
      prodCheck.hostname?.includes('-dev') || prodCheck.hostname?.includes('staging')
        ? ' Hosts like omni-dev.quloi.com should be allowed automatically — if you see this, update QUTIE or set ALLOW_PRODUCTION_URL=true.'
        : ' Use a staging/dev URL or set ALLOW_PRODUCTION_URL=true in .env.';
    throw new Error(
      `Production URL "${prodCheck.hostname}" is blocked (FR-17).${hint}`
    );
  }

  const { chromium } = await import('playwright');
  const ignoreHTTPSErrors =
    process.env.IGNORE_HTTPS_ERRORS === 'true' || process.env.NODE_ENV !== 'production';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors,
  });
  const page = await context.newPage();
  const secrets = [password, username];
  const results: TestResult[] = [];
  let tokenChecks = 0;
  let tokenPasses = 0;
  let authNote: string | undefined;
  let loginDebug: string[] | undefined;

  const evidenceCtx: EvidenceContext = {
    runId,
    secrets,
    verbose: verboseEvidence,
    globalStepIndex: 0,
    progress,
  };

  try {
    let login: LoginAttemptResult;
    try {
      if (progress) {
        progress.onStep({
          stepIndex: 0,
          action: 'auth',
          description: 'Authenticating against target...',
          status: 'running',
          testCaseId: LOGIN_CASE_ID,
          testCaseTitle: 'Login',
        });
      }
      login = await attemptLogin(page, normalizedUrl, { username, password }, { loginUrl, evidence: evidenceCtx });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      login = {
        success: false,
        error: `Authentication step crashed: ${msg}`,
        debug: [`Uncaught login error: ${msg}`],
      };
    }
    loginDebug = login.debug;
    if (login.skipped) {
      authNote = 'No credentials provided';
    } else if (!login.success) {
      authNote = login.error ?? 'Authentication failed';
    } else {
      const where = login.resolvedLoginUrl ? ` via ${login.resolvedLoginUrl}` : '';
      authNote = `Authenticated successfully${where}`;
    }

    for (const tc of testCases) {
      if (progress) {
        progress.onStep({
          stepIndex: evidenceCtx.globalStepIndex,
          action: 'test-start',
          description: `Running ${tc.id}: ${tc.title}`,
          status: 'running',
          testCaseId: tc.id,
          testCaseTitle: tc.title,
        });
      }
      const result = await runSingleTest(
        page,
        tc,
        appBaseUrl,
        { username, password },
        secrets,
        retryCount,
        brokenMode,
        authNote,
        evidenceCtx
      );
      result.runId = runId;
      results.push(result);

      if (tc.type === 'Design') {
        tokenChecks++;
        if (result.status === 'pass') tokenPasses++;
      }
    }
  } finally {
    await browser.close();
  }

  const designCompliance = tokenChecks ? Math.round((tokenPasses / tokenChecks) * 100) : 100;
  return {
    results,
    designCompliance,
    violations: tokenChecks - tokenPasses,
    authNote,
    loginDebug,
    productionWarning: prodCheck.warning,
  };
}

async function runSingleTest(
  page: import('playwright').Page,
  tc: TestCase,
  baseUrl: string,
  creds: { username: string; password: string },
  secrets: string[],
  retryCount: number,
  brokenMode?: boolean,
  authNote?: string,
  evidenceCtx?: EvidenceContext
): Promise<TestResult> {
  const resultId = `res-${tc.id}-${Date.now()}`;
  let lastError: string | undefined;
  let status: TestResult['status'] = 'fail';
  let isBlocked = false;
  let failingStep: number | undefined;
  let evidencePath: string | undefined;
  let actualResult: string | undefined;
  let attempts = 0;
  const stepEvidence: StepEvidence[] = [];
  const runId = evidenceCtx?.runId ?? '';

  const run = async (): Promise<boolean> => {
    try {
      for (const step of tc.steps) {
        const description = describeStep(step, baseUrl);
        const ok = await executeStep(page, step, baseUrl, creds, tc, brokenMode);
        const stepStatus: 'pass' | 'fail' = ok.success ? 'pass' : 'fail';

        if (evidenceCtx?.verbose) {
          const ev = await recordEvidence(
            evidenceCtx,
            page,
            tc.id,
            tc.title,
            step.action,
            description,
            stepStatus
          );
          if (ev) stepEvidence.push(ev);
        }

        if (!ok.success) {
          lastError = ok.error;
          failingStep = step.order;
          actualResult = ok.error;
          if (ok.blocked) {
            status = 'blocked';
            isBlocked = true;
          } else {
            status = 'fail';
          }
          const shotPath = path.join(evidenceDir, runId, tc.id, `step-${failingStep}-failure.png`);
          fs.mkdirSync(path.dirname(shotPath), { recursive: true });
          await redactSensitiveFields(page);
          await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
          evidencePath = shotPath;
          return false;
        }
      }
      return true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      status = 'blocked';
      isBlocked = true;
      failingStep = 1;
      actualResult = redactSecrets(lastError, secrets);
      const shotPath = path.join(evidenceDir, runId, tc.id, `step-failure.png`);
      fs.mkdirSync(path.dirname(shotPath), { recursive: true });
      await redactSensitiveFields(page);
      await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
      evidencePath = shotPath;
      return false;
    }
  };

  while (attempts <= retryCount) {
    attempts++;
    const passed = await run();
    if (passed) {
      if (attempts > 1) status = 'flaky';
      else status = 'pass';
      return {
        id: resultId,
        testCaseId: tc.id,
        runId,
        status,
        actualResult: tc.expectedResult,
        stepEvidence: stepEvidence.length ? stepEvidence : undefined,
      };
    }
    if (isBlocked) break;
    if (attempts <= retryCount) {
      stepEvidence.length = 0;
      await page.waitForTimeout(500);
    }
  }

  const detail = redactSecrets(actualResult ?? lastError ?? 'Unknown failure', secrets);
  const withAuth = authNote && authNote.includes('failed') ? `${detail} (${authNote})` : detail;

  return {
    id: resultId,
    testCaseId: tc.id,
    runId,
    status,
    actualResult: withAuth,
    failingStep,
    evidencePath,
    stepEvidence: stepEvidence.length ? stepEvidence : undefined,
  };
}

async function executeStep(
  page: import('playwright').Page,
  step: TestStep,
  baseUrl: string,
  creds: { username: string; password: string },
  tc: TestCase,
  brokenMode?: boolean
): Promise<{ success: boolean; error?: string; blocked?: boolean }> {
  const resolveValue = (v?: string) =>
    v?.replace('{{username}}', creds.username).replace('{{password}}', creds.password) ?? '';

  switch (step.action) {
    case 'navigate': {
      const url = step.target?.startsWith('http')
        ? step.target
        : new URL(step.target ?? '/', `${baseUrl}/`).href;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          blocked: true,
          error: `Navigation failed for ${url}: ${msg}. Verify the Product URL, VPN access, and IGNORE_HTTPS_ERRORS for cert issues.`,
        };
      }
      const title = await page.title().catch(() => '');
      const bodyVisible = await page.locator('body').isVisible().catch(() => false);
      if (!bodyVisible) {
        return { success: false, blocked: true, error: `Page loaded but body not visible (${url})` };
      }
      if (!title && page.url() === 'about:blank') {
        return { success: false, blocked: true, error: `Page did not load (${url})` };
      }
      return { success: true };
    }
    case 'fill': {
      const el = page.locator(step.target!);
      const count = await el.count();
      if (count === 0) return { success: false, error: `Element not found: ${step.target}`, blocked: true };
      await el.fill(resolveValue(step.value));
      return { success: true };
    }
    case 'click': {
      const el = page.locator(step.target!);
      if ((await el.count()) === 0) return { success: false, error: `Element not found: ${step.target}`, blocked: true };
      await el.click();
      await page.waitForTimeout(300);
      return { success: true };
    }
    case 'select': {
      const el = page.locator(step.target!);
      if ((await el.count()) === 0) return { success: false, error: `Select not found: ${step.target}`, blocked: true };
      await el.selectOption(step.value!);
      return { success: true };
    }
    case 'assert-page-contains': {
      const patterns = (step.value ?? '').split('|').map((p) => p.trim()).filter(Boolean);
      if (!patterns.length) return { success: true };
      const bodyText = ((await page.locator('body').textContent()) ?? '').toLowerCase();
      const matched = patterns.some((p) => bodyText.includes(p.toLowerCase()));
      if (!matched) {
        return {
          success: false,
          error: `Page content does not reflect requirement intent (expected one of: ${patterns.join(', ')})`,
        };
      }
      return { success: true };
    }
    case 'assert-visible': {
      const el = page.locator(step.target!);
      if ((await el.count()) === 0) return { success: false, error: `Expected visible: ${step.target}` };
      const visible = await el.first().isVisible();
      if (!visible) return { success: false, error: `Not visible: ${step.target}` };
      return { success: true };
    }
    case 'assert-text': {
      const el = page.locator(step.target!);
      if ((await el.count()) === 0) return { success: false, error: `Element not found: ${step.target}` };
      const text = await el.textContent();
      if (!text?.includes(step.value!)) {
        return { success: false, error: `Expected "${step.value}", got "${text?.trim()}"` };
      }
      return { success: true };
    }
    case 'assert-count': {
      const el = page.locator(step.target!);
      const count = await el.count();
      const expected = parseInt(step.value!, 10);
      if (count !== expected) return { success: false, error: `Expected ${expected} elements, found ${count}` };
      return { success: true };
    }
    case 'assert-disabled': {
      const el = page.locator(step.target!);
      if ((await el.count()) === 0) return { success: true };
      const disabled = await el.first().isDisabled().catch(() => false);
      if (!disabled) return { success: false, error: 'Row should be disabled but is selectable' };
      return { success: true };
    }
    case 'check-token': {
      const el = page.locator(step.target!);
      if ((await el.count()) === 0) return { success: false, error: `Token target not found: ${step.target}` };
      const check = await checkDesignToken(page, step.target!, step.value ?? '--shipped', brokenMode);
      if (!check.pass) {
        return { success: false, error: check.message };
      }
      return { success: true };
    }
    default:
      return { success: true };
  }
}

export function summarizeResults(results: TestResult[]) {
  const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0, flaky: 0 };
  for (const r of results) counts[r.status]++;
  const total = results.length;
  const passRate = total ? Math.round(((counts.pass + counts.flaky) / total) * 100) : 0;
  return {
    total,
    passed: counts.pass,
    failed: counts.fail,
    blocked: counts.blocked,
    skipped: counts.skipped,
    flaky: counts.flaky,
    passRate,
  };
}
