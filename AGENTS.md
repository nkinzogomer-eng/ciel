# AGENTS.md

## Project Context

This repository holds **two things** with a hard boundary between them:

| Path | What it is | Rule |
|------|------------|------|
| `ciel-core/` | the portable cognitive core | no `@base44/*`, no `npm:`, no `node:` import in `core/ domain/ engines/ interfaces/ capabilities/`; only Web standard APIs |
| `src/` + `base44/` | the Base44 console and its backend functions | may use the platform freely |

`ciel-core/README.md` is the entry point for the core. `README.md` is the entry point for
everything else. `ciel-core/status.ts` is the only honest map of what exists — keep it true.

## Commands

```bash
npm test            # 172 portable tests (Node 22 needed for --experimental-strip-types)
npm run lint        # ESLint over src/ and ciel-core/
npm run build       # Vite build of the console
npm run check       # lint + test + build
npm run ciel:serve  # standalone HTTP API (needs a token, or --allow-anon)
```

There is no `typecheck` script on purpose: `tsc` reports hundreds of false positives on
unannotated code and on the generated shadcn/ui components. Do not reintroduce one that
fails without checking anything useful.

## Key Files

- `ciel-core/runtime.ts` — `createCiel()`: assembles everything by injection.
- `ciel-core/orchestrator.ts` — the only end-to-end path: intention → mission → ledger.
- `ciel-core/index.ts` — public surface of the core (validated export list).
- `ciel-core/status.ts` — component status registry + `NOT_CLAIMED`.
- `base44/functions/*/entry.ts` — platform surfaces; they import `../../../ciel-core/...`.
- `base44/entities/CielRecord.jsonc` — generic persistence row, the Core never sees it.

## Working Notes

- A component is only listed in `status.ts` if the file it names exists. No aspirational rows.
- A new engine needs a suite in `ciel-core/tests/phaseX/` and a `status.ts` line.
- If you change the shape of `index.ts`, re-check every export actually exists (a phantom
  re-export breaks the standalone server at import time, not at type-check time).
- `base44 dev` runs the backend *and* the frontend; do not start `npm run dev` next to it.
- Never commit `.env.local` or `base44/.app.jsonc` (both gitignored).

## Base44 References

- CLI overview: https://docs.base44.com/developers/references/cli/get-started/overview.md
- Agent skills: https://docs.base44.com/developers/backend/overview/skills.md
