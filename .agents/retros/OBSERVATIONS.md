# Phoenix Crafty agent error patterns

This is a **small, persistent ledger**, not a dump of logs. Update on explicit `phoenix-improve-skills` requests. Group repeated errors by verified underlying cause; one failing job retried several times is still one independent incident. Never put secrets or device identifiers here.

`Reported (1)` means one issue was described in Luna's environment observation report, **not** independently reproduced here. These starting entries do **not** establish repeated errors.

| Pattern key | Category | Independent incidents | Evidence / last seen | Status | Existing prevention / next check |
|---|---|---:|---|---|---|
| `bun-unavailable` | environment | Reported (1) | `REVIEW.md` §1; 2026-11-20 report | monitor | `phoenix-environment-check`: preflight checks Bun, PATH; don't auto-install |
| `gh-wrong-repo` | environment | Reported (1) | `REVIEW.md` §2; 2026-11-20 report | addressed | `phoenix-environment-check`: verify origin and always pass `-R` |
| `biome-schema-warning` | maintenance | Reported (1) | `REVIEW.md` §3; 2026-11-20 report | monitor | Warning only; schedule update if repeated/impacting work |
| `pages-artifact-lookup` | CI/deploy | Reported (1) | `REVIEW.md` §4; 2026-11-20 report | addressed | Avoid rerunning upload+deploy job after upload succeeded |
| `vite-preview-subpath` | environment | Reported (1) | `REVIEW.md` §5; 2026-11-20 report | addressed | Use Vite preview with matching base and verify JS MIME |

When adding an observation, update an existing pattern if applicable. Preserve concise evidence references (task/run, file and line, date if known), the distinguishing context, and whether the workaround actually worked. Do not mark a root cause `verified` until supported by reproduction or authoritative logs. `Addressed` only means a preventive skill/check now covers it.
