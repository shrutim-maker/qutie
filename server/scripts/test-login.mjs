import { chromium } from 'playwright';
import { attemptLogin } from '../dist/services/executor.js';

const targetUrl = process.argv[2] ?? 'http://localhost:4000';
const username = process.argv[3] ?? 'qa.buyer@quloi.test';
const password = process.argv[4] ?? 'qutietestpass';
const loginUrl = process.argv[5] || undefined;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const result = await attemptLogin(page, targetUrl, { username, password }, { loginUrl });
console.log(JSON.stringify({ ...result, finalUrl: page.url() }, null, 2));

await browser.close();
process.exit(result.success ? 0 : 1);
