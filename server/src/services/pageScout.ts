import type { LoginAttemptResult } from './executor.js';
import { attemptLogin, checkProductionUrl, normalizeTargetUrl, resolveAppBaseUrl } from './executor.js';

/** Compact digest of a rendered page, fed to the AI generator so it emits real selectors. */
export interface PageDigest {
  url: string;
  title: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  inputs: Array<{ id?: string; name?: string; type?: string; placeholder?: string }>;
  buttons: string[];
  selects: Array<{ id?: string; name?: string; options: number }>;
  tables: Array<{ headers: string[] }>;
  statusElements: string[];
}

export interface PageContext {
  appBaseUrl: string;
  loginResult: Pick<LoginAttemptResult, 'success' | 'skipped' | 'error'>;
  pages: PageDigest[];
}

const SCOUT_TIMEOUT_MS = 60000;
const MAX_EXTRA_PAGES = 2;

async function digestPage(page: import('playwright').Page): Promise<PageDigest> {
  return page.evaluate(() => {
    // tsx/esbuild injects __name() around inner functions; stub it for the browser context
    const g = globalThis as { __name?: unknown };
    if (typeof g.__name !== 'function') g.__name = (fn: unknown) => fn;

    const text = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const visible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .filter(visible)
      .slice(0, 10)
      .map(text)
      .filter(Boolean);

    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(visible)
      .slice(0, 25)
      .map((a) => ({ text: text(a), href: (a.getAttribute('href') ?? '').slice(0, 120) }))
      .filter((l) => l.text || l.href);

    const inputs = Array.from(document.querySelectorAll('input, textarea'))
      .filter(visible)
      .slice(0, 25)
      .map((el) => {
        const input = el as HTMLInputElement;
        return {
          id: input.id || undefined,
          name: input.name || undefined,
          type: input.type || undefined,
          placeholder: input.placeholder || undefined,
        };
      });

    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
      .filter(visible)
      .slice(0, 15)
      .map((el) => {
        const id = (el as HTMLElement).id;
        return id ? `#${id} (${text(el)})` : text(el);
      })
      .filter(Boolean);

    const selects = Array.from(document.querySelectorAll('select'))
      .filter(visible)
      .slice(0, 10)
      .map((el) => {
        const sel = el as HTMLSelectElement;
        return { id: sel.id || undefined, name: sel.name || undefined, options: sel.options.length };
      });

    const tables = Array.from(document.querySelectorAll('table'))
      .slice(0, 3)
      .map((t) => ({
        headers: Array.from(t.querySelectorAll('th')).slice(0, 10).map(text).filter(Boolean),
      }));

    const statusElements = Array.from(
      document.querySelectorAll('[class*="pill" i], [class*="badge" i], [class*="status" i], [class*="chip" i]')
    )
      .slice(0, 10)
      .map((el) => `.${Array.from(el.classList).join('.')} (${text(el)})`)
      .filter(Boolean);

    return {
      url: location.href,
      title: document.title,
      headings,
      links,
      inputs,
      buttons,
      selects,
      tables,
      statusElements,
    };
  });
}

/**
 * Best-effort scout: log in to the target app and capture DOM digests of the landing
 * page plus a couple of in-app pages, so generated test steps use selectors that exist.
 * Returns undefined on any failure — generation proceeds without page context.
 */
export async function collectPageContext(
  targetUrl: string,
  creds: { username: string; password: string; loginUrl?: string }
): Promise<PageContext | undefined> {
  const normalized = normalizeTargetUrl(targetUrl);
  if (checkProductionUrl(normalized).blocked) return undefined;

  const { chromium } = await import('playwright');
  const ignoreHTTPSErrors =
    process.env.IGNORE_HTTPS_ERRORS === 'true' || process.env.NODE_ENV !== 'production';

  let browser: import('playwright').Browser | undefined;
  const scout = async (): Promise<PageContext | undefined> => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors });
    const page = await context.newPage();

    const login = await attemptLogin(
      page,
      normalized,
      { username: creds.username, password: creds.password },
      { loginUrl: creds.loginUrl }
    );

    const appBaseUrl = resolveAppBaseUrl(normalized);
    const pages: PageDigest[] = [await digestPage(page)];

    // Follow a couple of same-origin nav links for broader selector coverage
    const origin = new URL(appBaseUrl).origin;
    const candidates = pages[0].links
      .map((l) => {
        try {
          return new URL(l.href, `${origin}/`).href;
        } catch {
          return null;
        }
      })
      .filter((href): href is string => !!href && href.startsWith(origin) && href !== pages[0].url)
      .slice(0, MAX_EXTRA_PAGES);

    for (const href of candidates) {
      try {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        pages.push(await digestPage(page));
      } catch {
        /* skip unreachable pages */
      }
    }

    return {
      appBaseUrl,
      loginResult: { success: login.success, skipped: login.skipped, error: login.error },
      pages,
    };
  };

  const timeout = new Promise<undefined>((resolve) => {
    const t = setTimeout(() => resolve(undefined), SCOUT_TIMEOUT_MS);
    t.unref?.();
  });

  try {
    return await Promise.race([scout(), timeout]);
  } catch (err) {
    console.warn('[pageScout] scouting failed:', err instanceof Error ? err.message : err);
    return undefined;
  } finally {
    await browser?.close().catch(() => {});
  }
}
