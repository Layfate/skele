# Contributing to Skele

Thanks for helping! Skele is a local-first app: there's no backend, and that's deliberate.
Please keep it that way. Features must work offline, without an account, and without sending
user data anywhere unless the user explicitly turns on an integration.

## Setup

```bash
npm install
npm run dev            # http://127.0.0.1:3000
```

Use `127.0.0.1` rather than `localhost`. Spotify only accepts loopback IPs, and Next's dev
server is configured for that origin.

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e       # needs Playwright browsers: npx playwright install chromium
npm run build
```

CI runs the same checks.

## Guidelines

- **Data changes go through `src/data/repo/*`.** Components use the hooks in
  `src/features/*/hooks.ts` and never touch IndexedDB directly.
- **Changing stored data?** Keep old data readable. If you add a table or field, update the
  Dexie schema in `src/data/store.ts`, the backup manifest in `src/data/backup.ts`, and
  [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md). Add a test that imports an older backup.
- **Untrusted input:** imported files, Markdown and pasted content are untrusted. Documents
  pass through `sanitizeDoc`, attachments through `src/data/file-validation.ts`.
- **No secrets in the repo.** Spotify uses PKCE, so there is no client secret. Never commit
  `.env`, workspace exports, `.data/` or personal data.
- **Accessibility:** interactive elements need accessible names, everything must be reachable
  by keyboard, and motion respects `prefers-reduced-motion`.
- **Tests:** repository logic gets Vitest tests (`tests/unit`), user flows get Playwright tests
  (`tests/e2e`). Each Playwright test starts with empty storage.
- Keep pull requests focused, and describe what you tested.

## Commit messages

Short imperative summary (`Add bulk due-date action`), with details in the body if needed.

## Reporting bugs

Use the issue templates. Leave your notes out of the report. If a bug depends on content,
reduce it to a minimal example or use the sample workspace.
