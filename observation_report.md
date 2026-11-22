# Environment observations

These are observations from the recent ETA/theme work in this checkout. They
are operational notes for review, not confirmed defects in the application or
proof that Ghostex caused them.

## 1. Bun is missing from the interactive shell

- **Observed:** `bun` and `bunx` both returned `command not found`, although
  `package.json` declares `bun@1.4.4` and `node_modules` was present.
- **Impact:** Project scripts such as `bun run test`, `bun run typecheck`, and
  `bun run build` could not be invoked directly in the shell.
- **Workaround used:** Ran the installed `node_modules/.bin` tools directly:
  Paraglide compile, Vitest, TypeScript, Biome, and Vite. All requested local
  tests/typechecks/builds passed.
- **Possible improvement:** A project setup/verification skill could check the
  declared package manager and PATH first, then either use the matching
  installed runtime or explain the supported bootstrap. Avoid installing or
  changing dependencies as a fallback.

## 2. GitHub CLI defaulted to the upstream repository

- **Observed:** `gh` commands without `-R` queried
  `firsttris/reactive-volcano-app` rather than this checkout's
  `Finalize721/phoenix-crafty` origin. A run lookup consequently returned 404
  against the wrong repository.
- **Impact:** Workflow discovery and status checks could report unrelated
  results.
- **Workaround used:** Added `-R Finalize721/phoenix-crafty` to GitHub commands;
  subsequent run/deployment checks were correct.
- **Possible improvement:** A repo-aware skill should derive the repository
  from the checkout's `origin` and pass `-R` consistently. Optionally set the
  local `gh` default with `gh repo set-default Finalize721/phoenix-crafty`,
  while retaining the upstream remote.

## 3. Biome configuration schema is one patch behind the installed CLI

- **Observed:** Biome 2.6.4 reported that `biome.json` references schema 2.6.3.
- **Impact:** Informational warning only; lint checks passed.
- **Possible improvement:** Align the schema URL with the intentionally pinned
  Biome version, or pin the CLI to the schema version already in the config.
  No urgent fix appears necessary.

## 4. GitHub Pages artifact lookup failed on the first deployment attempt

- **Observed:** The push-triggered workflow passed tests, build, and artifact
  upload, but `deploy-pages` reported no `github-pages` artifact. Rerunning the
  failed job uploaded a second artifact with that name, so deployment then
  failed with “Multiple artifacts named `github-pages`”.
- **Impact:** The commit was not published by those two attempts.
- **Workaround used:** Started a fresh `workflow_dispatch` run on `main`. It
  passed and deployed successfully.
- **Possible improvement:** A deployment skill should inspect artifact-upload
  and deployment steps before retrying. If upload succeeded but lookup failed,
  prefer a fresh workflow run (or remove only the failed run's duplicate
  artifact) rather than blindly rerunning the deployment job. This looked like
  a GitHub Actions artifact/run issue; its cause is unconfirmed.

## 5. Production-preview subpath was not suitable for the local browser check

- **Observed:** A local Vite preview of the `/phoenix-crafty/` build returned
  the app HTML as a fallback for asset requests; Chromium then could not load
  the app scripts. The same mobile viewport check passed against the Vite dev
  server at `/`.
- **Impact:** The production-preview browser smoke test was blocked, not the
  production build or GitHub Pages deployment.
- **Possible improvement:** A preview skill should verify asset URLs and
  content types before treating a preview as ready, and use the correct base
  path/server root. The live Pages deployment was separately confirmed
  successful.
