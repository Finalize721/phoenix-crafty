# Phoenix Crafty — agent environment + skill improvement package

This ZIP **replaces** the earlier `phoenix-environment-audit.zip`. Give Luna only this ZIP, not both.

## What it contains

- `.agents/skills/phoenix-environment-check/` — read-only checks for the repo, tools and deployment workflow.
- `.agents/skills/phoenix-improve-skills/SKILL.md` — applies carefully verified lessons from **Matt Pocock’s existing `retro` skill** to project-local skills/checks. Does *not* duplicate or alter Matt’s original skill.
- `.agents/retros/OBSERVATIONS.md` — compact persistent record of the five initial, mostly unconfirmed operational incidents.
- `REVIEW.md` — audit of the original environment observations.

## One-time installation

Copy/merge `.agents/` into the root of `Finalize721/phoenix-crafty`, retaining other skills. You may also keep `REVIEW.md` in the repo. No application, CI, dependency, or Git settings are changed by installation.

## After an error-prone coding session

1. Run Matt Pocock’s `retro` skill to analyze the session (you already use his skills).
2. Run `phoenix-improve-skills` to **validate its recommendations** against available logs, update `.agents/retros/OBSERVATIONS.md`, and edit the existing project-local skill or diagnostic check **only if there is verified evidence** for a useful rule. If no solid finding, it should leave the skills untouched.

If commands aren't recognized in the agent interface, ask it:

> Read and follow `.agents/skills/phoenix-improve-skills/SKILL.md`, using the latest `retro` findings. Validate recurring issues, then make at most 1–3 evidence-backed project-local skill/check improvements. Don't change app or CI code.

`retro` only suggests changes: it does not automatically edit a skill. This second skill performs the optional implementation step when invoked. If the agent cannot access the earlier `retro` output, paste it or save it to a report; it cannot recover inaccessible Ghostex shell history.

For the environment-only diagnostic, run `bash .agents/skills/phoenix-environment-check/scripts/preflight.sh` at the repo root.

## Safety

No package installs, global settings changes, deploys, pushes, or unapproved edits to third-party/shared skills. Script checks are read-only. Coding bugs should lead to proposed regression tests rather than being misclassified as environment errors. A change to a skill is not proof the root cause was fixed.

## Related open-source skills

- Matt Pocock `retro`: https://github.com/mattpocock/skills/blob/main/skills/engineering/retro/SKILL.md
- eai-org `self-improve`: https://github.com/eai-org/agent-toolkit/blob/main/skills/self-improve/SKILL.md

The bundle contains original, project-specific guidance, not a copy of those skills.
