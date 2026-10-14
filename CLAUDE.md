# AFL Stats

A static AFL men's statistics site answering three questions: **team form**, **player comparison** and **all-time records**. A scheduled GitHub Actions job ingests Squiggle (JSON) and AFL Tables (HTML) into DuckDB, SQL models build the aggregates, a publisher writes static JSON, and a React + Vite SPA on Cloudflare Pages reads it. There are no servers, no runtime database and no secrets in the browser.

The full design is in `docs/proposal.md`. That file is local only and git-ignored, so it may be missing in CI or on a fresh clone. Read the relevant sections before starting a milestone: §5 layout, §6 source formats, §7 schema, §8 pipeline, §9 models, §10 data contract, §11 front end, §12 testing, §13 CI/CD, §15 milestones.

## Layout

npm workspaces, TypeScript, ES modules.

- `packages/core`: shared types, zod schemas, team/venue maps, stat definitions
- `packages/ingest`: HTTP client, raw cache, Squiggle and AFL Tables adapters and parsers
- `packages/warehouse`: DuckDB schema, loaders, SQL models, SQL data tests
- `packages/publish`: models → JSON shards in `apps/web/public/data/v1`
- `apps/web`: React + Vite SPA (Vitest + Testing Library unit tests, Playwright e2e in `e2e/`)

Workspace packages export their TypeScript source directly (`exports` → `src/index.ts`), so there's no build step between packages. `tsc -b` type-checks via project references.

## Commands

- `npm run check`: Biome lint and format check, then `tsc -b`. Use `npm run format` to auto-fix.
- `npm test`: Vitest across all workspaces.
- `npm run e2e`: Playwright smoke tests against `vite preview`. Run `npm run build` first.
- `npm run dev`: Vite dev server for `apps/web`.
- `npm run refresh -- --offline`: rebuild everything from the raw cache with no network. *Arrives in M1.*

## Rules

- TypeScript strict, ES modules. **No new dependencies without asking.** Pin exact versions.
- **zod v4 syntax only** (`import { z } from 'zod'`; e.g. `z.int()`, `z.iso.datetime()`, `z.strictObject()`). Many online examples are v3.
- **Never fetch from afltables.com or api.squiggle.com.au in tests.** Use fixtures in `packages/ingest/test/fixtures`. The ingest test setup stubs the global `fetch` to throw; inject a fake.
- All network access goes through `packages/ingest/src/http.ts` (UA + contact email, throttle, retry, cache). It reads the email from `CONTACT_EMAIL` (git-ignored `.env` locally, a repo variable in Actions) and never logs it.
- Every parser change needs a golden-file test. Commit fixtures before the parser.
- Generate SQL models from `stat_definition` where possible.
- Respect the published data contract in `packages/core/src/schemas.ts`. Changing it means bumping `data/v1` to `v2`.
- Don't commit `data/`, `apps/web/public/data/` or `docs/proposal.md`.

## Definition of done

`npm run check` and `npm test` pass, plus `npm run e2e` for UI changes.

## Workflow

- One milestone task per session. Plan first, then implement.
- Use a feature branch and a PR per milestone, so `ci.yml` checks it. Review the diff (`/code-review`) before merging.
