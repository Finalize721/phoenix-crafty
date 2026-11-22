---
name: phoenix-environment-check
description: Verify Phoenix Crafty development environment, correct fork/repository target, GitHub Pages deployments, and production subpath previews without changing tooling. Use before running project validation, diagnosing CI/deployment issues, or reporting environment-specific failures.
---

# Phoenix Crafty: environment and deployment checks

This skill addresses environment/tooling failures, not application bugs. Start by running the bundled *read-only* preflight from the repository root:

```bash
bash .agents/skills/phoenix-environment-check/scripts/preflight.sh
```

## 1. Verify repository identity first

- Source of truth: `git remote get-url origin`, not the `gh` implicit/default repository. For this fork it should resolve to `Finalize721/phoenix-crafty`.
- For all reads and write-capable GitHub CLI operations, pass `-R Finalize721/phoenix-crafty` explicitly **after checking the local `origin`**. If it differs, STOP and ask rather than use a guessed repository.
- Examples: `gh run list -R Finalize721/phoenix-crafty --workflow pages.yml --limit 5` and `gh run view RUN_ID -R Finalize721/phoenix-crafty`.
- Preserve upstream remotes. Do **not** silently execute `gh repo set-default`, change remotes, push, trigger workflows, or delete artifacts.

## 2. Match the declared project runtime

- `package.json` declares `bun@1.4.4`; GitHub Actions installs Bun explicitly via `oven-sh/setup-bun@v2`.
- Check `command -v bun`, `bun --version`, and `PATH`. If missing, inspect existing local runtime locations and installed `node_modules/.bin` tools before proposing setup.
- If Bun is available, prefer `bun run test`, `bun run typecheck`, `bun run build`.
- If Bun is unavailable, direct invocation of installed Paraglide/Vitest/tsc/Biome/Vite can be useful evidence, **but it is not an equivalent reproduction of scripts using `bun --bun`**. Report this limitation accurately. Never install or change dependency versions automatically to work around a missing shell command.
- A Biome schema patch-level mismatch is usually a maintenance warning, not a failure. Match the schema against the resolved/locked CLI version during scheduled maintenance; avoid unrelated lockfile updates.

## 3. GitHub Pages workflows and artifact retries

- Workflow: `.github/workflows/pages.yml`, single `deploy` job with upload and deploy steps.
- If `actions/deploy-pages` says an artifact is missing, inspect that *run*'s artifact list, upload step and job status before retrying.
- **Do not blindly rerun the whole job** after an artifact has been uploaded: another `github-pages` artifact in the same run can cause `Multiple artifacts named "github-pages"`.
- Prefer a **fresh** manual `workflow_dispatch` run after diagnosing a transient artifact lookup failure, with the user's approval. Re-running deployment or deleting run artifacts requires explicit instruction and care.
- Verify the new run's commit SHA, status, deployment URL, and HTTP asset responses. CI passed + workflow successful does not by itself prove that browser/hardware-specific functionality works.
- Separate scheduled maintenance: review Actions' Node.js runtime deprecation warnings and update major versions one at a time after checking official upgrade notes. Avoid blind version bumps during feature work.

## 4. Test the *production* subpath, not only the dev server

- Pages URL is `https://finalize721.github.io/phoenix-crafty/`; the build script uses `--base=/phoenix-crafty/`.
- After building, start local preview with the **matching base**:
  `./node_modules/.bin/vite preview --base=/phoenix-crafty/ --host 127.0.0.1`
  (or `bunx vite preview --base=/phoenix-crafty/ --host 127.0.0.1` if Bun is available).
- Test `http://127.0.0.1:4173/phoenix-crafty/`, not just `/`. Extract a real JS/CSS asset URL from the page; verify HTTP status and JavaScript/CSS MIME type. A 200 response containing HTML for a `.js` asset is a **failed** smoke test caused by SPA fallback or wrong path.
- `vite dev` passing at `/` is helpful but **does not verify** the production subpath, offline PWA behavior, Android Chrome, Bluetooth permissions, or actual Crafty+ hardware.

## 5. Report results precisely

For each check, distinguish: `PASS`, `FAIL`, `WARNING`, `NOT TESTED`. Include the commands executed and only the relevant redacted output. Never claim an unrun check succeeded. Avoid speculative claims that Ghostex caused the issue. Ask permission before modifying CI, installing runtimes, changing GitHub defaults or initiating deployments.
