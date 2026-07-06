import { chromium } from 'playwright';
import { attemptLogin } from '../dist/services/executor.js';

// Usage: node scripts/test-login.mjs <targetUrl> <username> <password> [loginUrl]
const targetUrl = process.argv[2];
const username = process.argv[3] ?? '';
const password = process.argv[4] ?? '';
const loginUrl = process.argv[5] || undefined;

if (!targetUrl) {
  console.error('Usage: node scripts/test-login.mjs <targetUrl> <username> <password> [loginUrl]');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const result = await attemptLogin(page, targetUrl, { username, password }, { loginUrl });
console.log(JSON.stringify({ ...result, finalUrl: page.url() }, null, 2));

await browser.close();
process.exit(result.success ? 0 : 1);
