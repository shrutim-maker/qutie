# QUTIE — Quloi Unified Testing & Intelligence Engine

AI QA agent that reads FRDs, BRDs, Confluence pages, and Jira tickets, generates executable test cases, runs them against a target build via browser automation, and files prioritised bugs to Jira with evidence.

## Quick start

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Start API (:3001) and UI (:5173)
npm run dev

# Optional — include local demo target app on :4000
npm run dev:demo
```

Open **http://localhost:5173** for the QUTIE dashboard.

## Getting started

1. **Add requirements** — Upload an FRD or BRD (`.pdf`, `.docx`, `.md`, `.txt`), paste requirement text directly, fetch a Confluence page, or connect Jira with a JQL query. Sources are additive — you can combine an FRD upload with Jira tickets. No bundled specs are included; you must provide your own.
2. **Set run instructions** (optional) — Tell QUTIE *how* to behave for this session (e.g. focus on login flow, test against staging, prioritize design token compliance). Instructions guide test generation and execution; they are not treated as requirements.
3. **Set target URL** — Point at your build (e.g. `http://localhost:4000` for the local demo app, or your staging URL like `https://omni-dev.quloi.com/login`). Production hosts (`app.quloi.com`, `*.quloi.com`) are blocked by default; dev/staging subdomains (`omni-dev`, `*-dev`, `staging.*`) are allowed automatically.
4. **Enter credentials** (if your app has a login form) — QUTIE attempts common email/password selectors before running tests. Optionally set **Login URL** if sign-in lives on a different path (e.g. `/login`). See [Login configuration](#login-configuration) below.
5. **Generate test cases** — QUTIE parses your requirements and maps test cases with coverage %.
6. **Run suite** — Playwright executes tests against the target app.
7. **Bugs** — Review prioritised bugs; confirm before filing to Jira.
8. **Dashboard** — Release readiness score, pass rate trend, and bug severity after your first run.

## Architecture

| Module | Path | Description |
|--------|------|-------------|
| API server | `server/` | Express + SQLite + Playwright |
| Dashboard UI | `client/` | React + Vite |
| Demo target app | `demo-app/` | Local test target on :4000 (optional) |

## AI test generation

Set `ANTHROPIC_API_KEY` in `.env` to switch test generation from templates to **Claude** (`claude-opus-4-8` by default, override with `QUTIE_AI_MODEL`):

- Claude reads every ingested requirement and writes tailored test cases (positive, negative, edge, design) with steps in QUTIE's executable action set.
- If a **Product URL** (and credentials, for apps behind login) is set before generating, QUTIE first *scouts* the live app — logs in, captures DOM digests of the landing page and nearby pages — so generated steps use selectors that actually exist.
- Without a key, or if the API call fails, QUTIE falls back to the built-in template generator automatically (the UI shows which generator ran).

## Environment variables

```bash
# Optional — enables Claude-powered test generation (falls back to templates without it)
ANTHROPIC_API_KEY=your-key
QUTIE_AI_MODEL=claude-opus-4-8
# Optional — allow running against production hosts (FR-17 override)
ALLOW_PRODUCTION_URL=true

# Optional — ignore TLS certificate errors on staging/self-signed hosts
IGNORE_HTTPS_ERRORS=true

# Optional — without these, Jira filing runs in mock mode (no real API writes).
# Defaults to the HACK sandbox project on quloi.atlassian.net (FR-22).
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=your-token
JIRA_BASE_URL=https://quloi.atlassian.net
JIRA_PROJECT_KEY=HACK

# Optional — Confluence requirement ingestion (falls back to JIRA_EMAIL / JIRA_API_TOKEN)
CONFLUENCE_BASE_URL=https://your-org.atlassian.net
CONFLUENCE_EMAIL=your@email.com
CONFLUENCE_API_TOKEN=your-token
```

Jira **ingestion** requires credentials. Confluence **ingestion** requires `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` (or the Jira equivalents). Without them, use file upload for requirements.

### Confluence setup

1. Create an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) for your account.
2. Set `CONFLUENCE_BASE_URL` to your Cloud site (e.g. `https://your-org.atlassian.net`).
3. Set `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` (or reuse `JIRA_EMAIL` / `JIRA_API_TOKEN`).
4. In the QUTIE UI, open **Confluence** under requirement sources and provide:
   - A **page URL** (e.g. `…/wiki/spaces/SPACE/pages/123456/Title`), or
   - A **page ID**, or
   - A **space key** + **page title** search.

QUTIE fetches page content via the Confluence REST API (`GET /wiki/rest/api/content`), converts storage-format HTML to plain text, and extracts FR-/BRD-style requirements the same way as DOCX ingestion.

## Login configuration

QUTIE logs in **once per run** before executing tests (session persists in the same browser context).

| Field | Purpose |
|-------|---------|
| **Product URL** | Base app URL tests navigate against (e.g. `https://omni-dev.quloi.com` or the login page `https://omni-dev.quloi.com/login`) |
| **Login URL** *(optional)* | Path or full URL only when sign-in differs from Product URL (e.g. Product URL = `https://omni-dev.quloi.com`, Login URL = `/login`) |
| **Username / Password** | Test account credentials |

**What QUTIE tries automatically** (no product-specific selectors):

1. Navigate to Login URL, or Product URL
2. Dismiss common cookie/consent banners
3. Click visible “Sign in” / “Log in” links if no form is present
4. Probe common paths: `/login`, `/signin`, `/sign-in`, `/auth/login`, etc.
5. Find fields via type/name/id/placeholder/autocomplete, labels, and iframes
6. Support multi-step flows (email → Continue → password)
7. Detect success (URL left login page, logout/profile visible) or failure (error alerts)

**After each run**, expand **Login debug** in Results to see every step attempted.

**Works well with:** standard HTML forms, separate `/login` pages, multi-step email-then-password, cookie banners.

**Does not support:** Google/Microsoft SSO, CAPTCHA, magic-link email, or hardware MFA. For those, use a staging environment with a direct username/password login or a test bypass URL.

**Demo app** (`http://localhost:4000`): use `qa.buyer@quloi.test` / `qutietestpass` — login form is on `/` with `#username`, `#password`, `#login-btn`.

## Demo target app

The app on `:4000` is an optional local test target — it is not auto-wired into QUTIE. Point the target URL at it manually if you want to test against it.

Use `?broken=1` on the demo URL to activate planted bugs for manual testing:

- **Design token violation** — Shipped pill uses wrong color
- **Empty destination accepted** — Booking form skips validation
- **IncoTerm filter** — Filter does not constrain row selection

## FRD coverage (MVP)

- ✅ FR-1 to FR-5: Requirement ingestion (upload, Confluence, Jira, parse, ambiguous flagging, traceability)
- ✅ FR-6 to FR-10: Test case generation, coverage reporting
- ✅ FR-11 to FR-17: Browser execution, auth, retries/flaky, prod URL block
- ✅ FR-18 to FR-20: Result evaluation and run summary
- ✅ FR-21 to FR-26: Bug reports, Jira sync with confirmation gate, dedup
- ✅ FR-27 to FR-30: Severity/priority assignment
- ✅ FR-31 to FR-33: Screenshot evidence with redaction
- ✅ FR-34 to FR-39: Dashboard, readiness score, export
- ✅ FR-40 to FR-42: Design token compliance
- ✅ FR-43 to FR-44: Release readiness scoring
- ✅ FR-45 to FR-47: Credential handling (session-scoped, redacted)
