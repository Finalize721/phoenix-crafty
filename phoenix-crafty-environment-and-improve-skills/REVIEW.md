# Phoenix Crafty environment observations — independent review (2026-11-21)

This review covers the five observations in `observation_report.md` as supplied in the conversation. It does **not** independently reproduce the local Ghostex shell failures. Public repository, workflow and vendor documentation were checked.

## Conclusions

1. **Bun unavailable:** `package.json` declares `bun@1.4.4`; `.github/workflows/pages.yml` explicitly sets up Bun before using the Bun scripts. Local missing executable is a PATH/bootstrap condition, not an established application defect. Direct `node_modules/.bin` checks are useful but not identical to the Bun runtime used in CI. Prefer documenting a preflight over automatically installing dependencies.
2. **`gh` wrong default:** Highest operational risk because status checks and write operations could address upstream. Derive origin from `git remote get-url origin`, verify `Finalize721/phoenix-crafty`, and use explicit `-R` for every `gh` call. Do not silently mutate gh defaults.
3. **Biome schema mismatch:** `biome.json` has the 2.6.3 schema URL, with a report of Biome CLI 2.6.4. Non-blocking maintenance warning. Verify resolved version when next intentionally updating toolchain. `package.json` allows compatible updates (`^2.5.15`).
4. **Pages artifacts:** Failure for workflow run #13 is confirmed as duplicate `github-pages` artifacts. Fresh workflow_dispatch run #14 was successful for the same commit SHA `9a0873b`. Current workflow places upload and deploy in the same job, explaining why a rerun can upload again. No evidence of an ongoing deployment outage. Never blindly retry the same upload+deploy job once upload succeeded; use fresh workflow run after diagnosis and approval.
5. **Vite preview:** Current build script uses `vite build --base=/phoenix-crafty/`. Vite preview supports `--base`. Start `vite preview --base=/phoenix-crafty/` and verify a real JS asset gets JavaScript MIME and HTTP 200, not index.html fallback. Development server at `/` is not a production deployment test.

## Additional observation

Successful workflow #14 reports Node.js 20 deprecation warnings in GitHub Actions. Consider planned dependency/action-major upgrades, using up-to-date official documentation and isolated CI testing. This is not proof of a runtime problem in the app.

## Suggested integration

Copy `.agents/skills/phoenix-environment-check/` into the project's `.agents/skills/` directory. The bundled `scripts/preflight.sh` runs without installs or network calls; it reports the checkout origin, Bun, and local tool availability. The skill documents safe validation and deployment behavior.

**Not validated:** actual local Bun/PATH resolution; exact Ghostex defaults; Android Chrome battery/Bluetooth behavior; production browser smoke test. Those require the checkout/device/authorized session.

Sources reviewed:
- https://github.com/Finalize721/phoenix-crafty
- https://raw.githubusercontent.com/Finalize721/phoenix-crafty/main/package.json
- https://raw.githubusercontent.com/Finalize721/phoenix-crafty/main/biome.json
- https://raw.githubusercontent.com/Finalize721/phoenix-crafty/main/.github/workflows/pages.yml
- https://github.com/Finalize721/phoenix-crafty/actions/runs/44839776711
- https://github.com/Finalize721/phoenix-crafty/actions/runs/44839957240
- https://vite.dev/guide/cli
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
