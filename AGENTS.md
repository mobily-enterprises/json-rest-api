# Repository Guidelines

## Project Structure & Module Organization
- `index.js` re-exports the public plugins from `plugins/` (REST API core, access, CORS, file, connectors) so new features slot in there.
- Shared helpers and error types live in `lib/`; reuse or extend these modules before adding new utilities elsewhere.
- Scenario walkthroughs are under `examples/`, long-form references stay in `docs/`, and development scripts reside in `scripts/`.
- Tests sit in `tests/` with fixtures at `tests/fixtures/`, helpers in `tests/helpers/`, and `quickTest.js` provides a throwaway API for manual poking.

## Build, Test, and Development Commands
- `npm test` runs `node --test tests/*.test.js` against the in-memory SQLite fixtures; run it before every push.
- `node quickTest.js` spins up an in-memory API instance for experimenting with endpoints during development.
- `npm run docs` rebuilds the static docs via `scripts/run-docs.js` whenever reference prose changes.
- `npm run sloc` prints a line-count summary to gauge change size before opening a PR.

## Coding Style & Naming Conventions
- Stay with ESM (`"type": "module"`) and export named symbols only; avoid `default` exports for predictable tree-shaking.
- Use two-space indentation and keep existing spacing in JSON fixtures and migration files.
- Name runtime files in lower-kebab case (e.g., `rest-api-knex-plugin.js`) and mirror that pattern for tests like `bulk-operations.test.js`.
- Keep comments brief and reserved for decisions that are not obvious from the code.

## Testing Guidelines
- Instantiate the API once per suite following `tests/TEST_TEMPLATE.test.js`, and call `cleanTables()` in `beforeEach` to reset state.
- Seed data through helpers in `tests/fixtures/api-configs.js`; never invoke `api.addResource` directly in test code.
- Run suites in strict JSON:API mode (`simplified: false`) unless the scenario explicitly covers the simplified flag.
- Prefer the shared assertion helpers for response checks to keep expectations consistent.

## Commit & Pull Request Guidelines
- Use concise, capitalised commit subjects that highlight the affected area (e.g., `Access rules tightened`) and group related changes per commit.
- Pull requests should include a short summary, linked issue reference, impacted plugins or resources, and `npm test` output or the reason it was skipped.
- Document externally visible updates with sample payloads or screenshots, and note configuration changes in `docs/` for downstream teams.

## Security & Configuration Tips
- Keep secrets in local `.env` files; never commit environment-specific strings.
- When adding connectors or auth flows, review `plugins/core/rest-api-cors-plugin.js`, update optional peers (`express`, `redis`, `socket.io`) if required, and document new toggles in `docs/`.
