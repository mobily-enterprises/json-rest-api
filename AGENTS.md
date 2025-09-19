# Repository Guidelines

## Project Structure & Module Organization
The public entry point `index.js` re-exports the core plugins that live in `plugins/` (REST API, access, CORS, file handling, connectors). Shared utilities and error classes sit under `lib/`. Scenario-driven examples are in `examples/`, while longer-form references and comparison guides stay in `docs/`. Automated tests target `tests/*.test.js`, backed by shared fixtures in `tests/fixtures/` and helpers in `tests/helpers/`. Scripts used during development are in `scripts/`, and `quickTest.js` provides a minimal end-to-end demo.

## Build, Test, and Development Commands
Run `npm test` to execute the Node test runner (`node --test tests/*.test.js`) against the in-memory SQLite fixtures. Use `npm run docs` to rebuild the static documentation via `scripts/run-docs.js`. `npm run sloc` gives a quick surface area snapshot before PRs, and `node quickTest.js` spins up a throwaway API for manual exploration.

## Coding Style & Naming Conventions
Follow the repository’s ESM-first layout (`"type": "module"`) and two-space indentation. Prefer descriptive resource and file names, mirroring existing patterns such as `rest-api-knex-plugin.js`. Keep exports explicit from modules; avoid default exports. Tests and fixtures use lower-kebab case (`bulk-operations.test.js`, `api-configs.js`), so mirror that convention when adding new files.

## Testing Guidelines
Tests must instantiate APIs once per suite (see `tests/TEST_TEMPLATE.test.js`) and reset state with `cleanTables()` in `beforeEach`. Create resources exclusively through API helpers declared in `tests/fixtures/api-configs.js`; never call `api.addResource` inside test files. Always run in strict JSON:API mode (`simplified: false`) unless a test explicitly covers simplified behaviour, and validate responses with the helper assertions. Limit direct database access to the provided counting and cleanup utilities.

## Commit & Pull Request Guidelines
Follow the existing concise, capitalised commit subjects (e.g., `Auth moved out`, `Security improvements`). Group logical changes per commit and mention affected plugins or connectors directly. Pull requests should include: a short summary, linked issue (if any), a list of impacted resources/plugins, test evidence (`npm test` output or reasoning for omissions), and notes for downstream integrators when API contracts shift. Attach screenshots or example payloads for HTTP-visible changes.

## Security & Configuration Tips
Do not commit secrets or environment-specific connection strings; prefer local `.env` files ignored by Git. Keep optional peer dependencies (`express`, `redis`, `socket.io`, etc.) updated when exercising those connectors. When adding new storage adapters or auth flows, document the necessary configuration toggles in `docs/` and ensure cross-origin rules in `plugins/core/rest-api-cors-plugin.js` stay restrictive by default.
