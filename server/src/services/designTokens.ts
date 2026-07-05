import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.join(__dirname, '..', '..', 'data', 'design-tokens.json');

export interface DesignTokens {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  typography: Record<string, string>;
}

export function loadDesignTokens(): DesignTokens {
  if (fs.existsSync(tokensPath)) {
    return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  }
  return {
    colors: {
      '--shipped': '#14B8A6',
      '--pass': '#67B68F',
      '--fail': '#D76666',
      '--navy-primary': '#1D3E69',
      '--cyan': '#56E6FF',
    },
    spacing: { '--radius': '5.88px' },
    radius: { '--radius': '5.88px', '--radius-pill': '22.02px' },
    typography: { '--font-family': 'Poppins, sans-serif' },
  };
}

function normalizeColor(c: string): string {
  return c.replace(/\s/g, '').toLowerCase();
}

function colorsMatch(a: string, b: string): boolean {
  const na = normalizeColor(a);
  const nb = normalizeColor(b);
  if (na === nb) return true;
  // Allow rgb vs hex approximate match
  return na === nb;
}

export async function checkDesignToken(
  page: import('playwright').Page,
  selector: string,
  tokenName: string
): Promise<{ pass: boolean; message: string }> {
  const tokens = loadDesignTokens();
  const expected = tokens.colors[tokenName] ?? '#14B8A6';

  const actual = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    return style.backgroundColor || style.color;
  }, selector);

  if (!actual) {
    return { pass: false, message: `Could not read computed style for ${selector}` };
  }

  // Convert expected hex to rgb for comparison
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const expectedRgb = hexToRgb(expected);
  if (colorsMatch(actual, expectedRgb) || colorsMatch(actual, expected)) {
    return { pass: true, message: 'Token compliant' };
  }

  return {
    pass: false,
    message: `Rendered ${actual}, expected token ${tokenName} ${expected}`,
  };
}

export function computeComplianceScore(passed: number, total: number): number {
  if (!total) return 100;
  return Math.round((passed / total) * 100);
}
