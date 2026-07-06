Functional Requirements Document: QUTIE
QUTIE: Quloi Unified Testing & Intelligence Engine

Field
Value
Product
QUTIE (AI QA agent)
Owner
Shruti (Lead UI/UX + PM)
Status
Draft v1.0, MVP scope
Stakeholders
Erman, Irshad, Matt
Related
Hackathon build "QA Brain", HACK Jira sandbox
Jira site
quloi.atlassian.net


1. Purpose
QUTIE is a Quloi-native AI QA agent. It reads our own requirement artifacts (FRD, BRD, Jira), turns them into executable test cases, runs them against a running build, and reports what passed, what failed, and how ready the release is. It files bugs, prioritises them, and gives QA and PM a single dashboard instead of a spreadsheet.

The wedge is context. Generic tools (Mabl, Momentic) automate clicks but do not know a Quloi spec, our design tokens, our order lifecycle, or our Jira structure. QUTIE reads all of that, so its test cases and bug reports speak our language and map to our requirements out of the box.
2. Problem
Today QA is manual and requirement coverage is unverifiable. Test cases live in someone's head or a stale sheet, bugs get filed inconsistently, and nobody can answer "is this release actually ready" with a number. Regression is slow, and design drift (spacing, colour, component misuse) slips through because no one checks tokens by hand.
3. Scope
In scope (MVP)

Ingest FRD, BRD, and Jira tickets as requirement sources.
Generate test cases from those sources.
Execute test cases via browser automation against a target URL with supplied credentials.
Record pass/fail/blocked, capture screenshots.
Prioritise failures and file bugs to the HACK sandbox project in Jira.
Design token compliance check.
Release readiness score.
Dashboard for runs, results, coverage, and bugs.

Out of scope (MVP, tracked for later)

API and backend contract testing.
Load, performance, and security penetration testing.
Mobile native app testing.
Cross-browser matrix beyond a single default browser.
Self-healing selectors and full autonomous exploration.
Multi-tenant / multi-project Jira routing beyond HACK.
4. Users
Persona
Goal in QUTIE
QA engineer
Generate and run test cases, triage failures, file clean bugs fast.
PM (Shruti, Erman)
See coverage and readiness at a glance, decide go / no-go.
Designer
Catch token and component drift before it ships.
Engineering lead (Irshad)
Get reproducible bug reports with evidence, tied to a requirement.
5. System modules
QUTIE is composed of eight logical modules. Requirements below are grouped by module.

Requirement Ingestion
Test Case Generation
Test Execution
Result Evaluation
Bug Management and Jira Sync
Bug Prioritisation
Evidence Capture (screenshots)
Dashboard and Reporting

Cross-cutting: Credential and Secret Handling, Design Token Compliance, Release Readiness Scoring.


6. Functional requirements
6.1 Requirement Ingestion
FR-1 QUTIE shall accept an FRD or BRD as input by file upload (PDF, DOCX, Markdown) or by pasted text.

FR-2 QUTIE shall accept Jira tickets as input by issue key, JQL query, or project selection, pulling summary, description, acceptance criteria, and linked issues via the Atlassian API.

FR-3 QUTIE shall parse each source into discrete, testable requirement statements and assign each a stable requirement ID (for FRDs it shall preserve existing FR-numbers where present).

FR-4 QUTIE shall flag requirements it judges ambiguous or untestable and surface them to the user rather than silently dropping them.

FR-5 QUTIE shall build a requirement-to-test traceability record linking every generated test case back to its source requirement.
6.2 Test Case Generation
FR-6 QUTIE shall generate test cases from ingested requirements, each with: ID, title, source requirement link, preconditions, ordered steps, test data, and expected result.

FR-7 QUTIE shall generate positive (happy path), negative, and edge case tests where the requirement implies them (empty states, invalid input, boundary values, permission-denied paths).

FR-8 QUTIE shall let the user review, edit, add, and remove generated test cases before execution. Generation is a suggestion, not a lock.

FR-9 QUTIE shall persist test cases so they can be re-run as a regression suite without regenerating.

FR-10 QUTIE shall report requirement coverage as the percentage of requirements with at least one associated test case, and list uncovered requirements explicitly.
6.3 Test Execution
FR-11 QUTIE shall accept a target product URL and login credentials, then execute the selected test suite via headless browser automation.

FR-12 QUTIE shall authenticate against the target using the supplied credentials before running any authenticated test.

FR-13 QUTIE shall execute each test step, resolve UI elements, perform the interaction, and capture the resulting state.

FR-14 QUTIE shall support running a single test, a selected subset, or the full suite.

FR-15 QUTIE shall handle timeouts, missing elements, and navigation failures gracefully, marking the affected test as Blocked (not silently Passed) with the reason recorded.

FR-16 QUTIE shall support a configurable retry on transient failures and shall mark a test that passes only on retry as Flaky.

FR-17 QUTIE shall refuse to run a destructive or write-heavy suite against a URL flagged as production, and shall require an explicit non-production target for MVP.
6.4 Result Evaluation
FR-18 QUTIE shall compare actual result against expected result for each test and assign a status of Pass, Fail, Blocked, or Skipped.

FR-19 QUTIE shall record, per test, the actual observed value, the step at which a failure occurred, and a timestamp.

FR-20 QUTIE shall produce a per-run summary: total, passed, failed, blocked, skipped, flaky, and pass rate.
6.5 Bug Management and Jira Sync
FR-21 QUTIE shall generate a structured bug report for each failed test containing: title, severity, priority, environment (URL, browser), steps to reproduce, expected vs actual, screenshots, and links to the source test case and requirement.

FR-22 QUTIE shall file bugs into the HACK sandbox project on quloi.atlassian.net, mapping QUTIE fields to Jira fields (summary, description, priority, labels, attachments).

FR-23 QUTIE shall present the exact Jira payload for review and require explicit confirmation before creating, editing, or transitioning any Jira issue. An "auto-file" mode may be enabled per run, but confirmation-first is the default.

FR-24 QUTIE shall deduplicate before filing: if a matching open bug already exists (same test case or same signature), it shall link or comment on the existing issue instead of creating a duplicate.

FR-25 QUTIE shall write the created Jira issue key back onto the failed test case so the dashboard shows the link.

FR-26 QUTIE shall never permanently delete Jira issues and shall never modify Jira access or permissions.
6.6 Bug Prioritisation
FR-27 QUTIE shall assign each bug a severity based on failure type: functional break, data error, blocking flow, cosmetic, or design token violation.

FR-28 QUTIE shall assign each bug a priority derived from severity combined with the criticality of the affected flow (a broken booking or order action outranks a cosmetic issue) and reproducibility.

FR-29 QUTIE shall map its internal priority to Jira priority (Blocker, Critical, Major, Minor, Trivial) so triage is consistent.

FR-30 QUTIE shall allow the user to override any assigned severity or priority before filing.
6.7 Evidence Capture
FR-31 QUTIE shall capture a screenshot at the point of failure for every failed test and attach it to the bug report and Jira issue.

FR-32 QUTIE shall capture step-level screenshots for a test when verbose evidence is enabled.

FR-33 QUTIE shall redact any visible credential or sensitive value from captured screenshots before storing or attaching them.
6.8 Dashboard and Reporting
FR-34 QUTIE shall provide a dashboard showing, per run: release readiness score, test summary (pass / fail / blocked / skipped), pass rate, and bugs by severity and priority.

FR-35 QUTIE shall show requirement coverage and design token compliance as headline metrics on the dashboard.

FR-36 QUTIE shall show a pass rate trend across runs so regressions and improvements are visible over time.

FR-37 QUTIE shall let the user filter results by requirement source, module, run, status, and severity.

FR-38 QUTIE shall link each result row to its test case, evidence, and Jira issue.

FR-39 QUTIE shall export a run report (bug list plus summary) for sharing with stakeholders.
6.9 Design Token Compliance (Quloi-native differentiator)
FR-40 QUTIE shall check rendered UI against the authoritative Quloi design tokens (colour, type scale, radius, spacing) and flag violations.

FR-41 QUTIE shall treat token violations as bugs with a Design severity, feeding the same prioritisation and Jira flow.

FR-42 QUTIE shall report a design token compliance score as part of release readiness.
6.10 Release Readiness Scoring
FR-43 QUTIE shall compute a release readiness score per run from weighted inputs: pass rate, requirement coverage, count and severity of open bugs, and design token compliance.

FR-44 QUTIE shall show the score, its inputs, and a plain go / caution / no-go band so a PM can decide without reading the whole report.
6.11 Credential and Secret Handling (cross-cutting)
FR-45 QUTIE shall store credentials in a secret store, never in plaintext logs, test case bodies, screenshots, or Jira issues.

FR-46 QUTIE shall redact secrets from all user-visible output and all persisted artifacts.

FR-47 QUTIE shall scope credentials to a single run or session and not reuse them beyond the target the user supplied.


7. Non-functional requirements
Area
Requirement
Security
Credentials vaulted and redacted (FR-45 to FR-47). No secrets in Jira or screenshots.
Reliability
Transient failures retried; flaky tests flagged, not hidden.
Auditability
Every Jira write, every run, and every override is logged with actor and timestamp.
Performance
A single test executes and reports within a few seconds under normal conditions.
Extensibility
Ingestion sources and reporting targets are pluggable so Confluence, Slack, and more Jira projects can be added later.
Usability
A PM can read readiness and decide go / no-go without opening a test case.
8. Core data entities
Requirement: id, source type, source ref, text, testable flag.
Test Case: id, requirement id, title, preconditions, steps, test data, expected result, status.
Test Run: id, target URL, environment, start/end time, summary, readiness score.
Result: test case id, run id, status, actual result, failing step, evidence refs.
Bug: id, result id, severity, priority, report body, jira key, status.
Evidence: id, result id, type (screenshot), storage ref, redacted flag.
9. Integrations
Atlassian Jira: read tickets (FR-2), file and update bugs (FR-22 to FR-25). MVP scoped to HACK project.
Browser automation engine: test execution (FR-11 to FR-17).
Secret store: credential handling (FR-45 to FR-47).
Later: Confluence (publish reports), Slack (run notifications), Figma or token file (design token source of truth).
10. Assumptions and dependencies
Target build is reachable and reasonably stable during a run.
Requirement sources are readable (not scanned images) or Jira access is granted.
Atlassian credentials and HACK project access are available to QUTIE.
Design tokens are available in a machine-readable form for FR-40.
11. Acceptance criteria (MVP demo)
Feed QUTIE an FRD or Jira ticket; it produces reviewable test cases mapped to requirements.
Give it the target build's URL and login; it runs the suite and reports pass/fail with screenshots.
It catches the planted bugs, prioritises them, and files them to HACK after confirmation, with a screenshot attached and no duplicates.
The dashboard shows summary, coverage, token compliance, and a readiness score.
12. Success metrics
Requirement coverage generated per source (target: high coverage with low manual editing).
Time from spec to first test run (target: minutes, not hours).
Bug report completeness (every filed bug has repro steps, evidence, and a requirement link).
Reduction in manual QA time per release cycle.
13. Open questions
Which browser engine for MVP, and do we need more than one before demo?
Token source of truth for FR-40: static token file, or read live from the design system?
Default confirmation gate vs auto-file for the Tuesday demo (recommend confirmation-first, auto-file as a toggle).
Readiness score weights: who signs off on the formula (PM + eng lead)?
14. Phase 2 candidates
API and contract testing, cross-browser matrix, self-healing selectors, autonomous exploratory testing, multi-project Jira routing, Confluence and Slack publishing, performance and accessibility checks.

