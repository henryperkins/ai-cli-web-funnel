# Build Prompt: Scoped v1 GA Closure

Use this prompt with an implementation agent to close the remaining gaps for the current scoped v1 GA target.

```text
You are an implementation agent working in /home/azureuser/ai-cli-web-funnel.

Mission:
Close the remaining scoped v1 GA gaps for Forge without broadening product scope beyond the current compatibility lock.

North-star loop:
1. discover
2. plan
3. install
4. verify

Current ground truth (do not reinterpret):
1. The core platform is implemented: catalog discovery/search/freshness APIs, install lifecycle (plan/apply/verify/update/remove/rollback), profile flows, runtime verification, retrieval, and governance are all present in source.
2. Current technical validation baseline is green:
   - `npm run check`
   - `npm run test:e2e-local`
   - `npm run verify:migrations:dr018`
3. The v1 support boundary is explicitly locked to:
   - client: `vscode_copilot`
   - mode: `local`
   - transport: `stdio`
4. `docs/ga-readiness-review-2026-03-08.md` is blocked because no pilot traffic has occurred yet; all KPI windows are `insufficient_data`.
5. `docs/release-evidence.md` is still `DRAFT`.
6. `docs/application-completion-backlog.md` currently marks:
   - `E10-S1` Ready for Execution
   - `E10-S2` In Progress
   - `E10-S3` In Progress
7. Human pilot traffic and human sign-offs are real dependencies. They must not be faked, implied, or silently bypassed.

What “done” means for this mission:
1. Everything that can be closed in code, scripts, workflows, templates, and docs for the scoped v1 GA target is closed.
2. The only remaining blockers, if any, are irreducibly external:
   - live pilot traffic,
   - human launch sign-offs,
   - CI-held secrets or release credentials.
3. Those remaining blockers are surfaced explicitly in artifacts, commands, and docs.

Non-negotiable constraints:
1. Do not broaden client or transport scope beyond the current v1 compatibility lock.
2. Do not change KPI thresholds or evidence statuses to manufacture a green GA result.
3. Do not silently change AQ/MQ/DR governance statuses to `Approved`.
4. Preserve idempotency semantics everywhere:
   - same key + same hash => replay
   - same key + different hash => conflict
5. Keep migrations additive and forward-only.
6. Keep privacy and secret-handling posture intact:
   - no plaintext secret persistence,
   - no unsafe telemetry persistence,
   - secret refs only where required.
7. Treat unavailable pilot data as `blocked` or `insufficient_data`, not as pass.
8. Do not rewrite existing status docs to imply live execution happened when it did not.

Primary objectives:
1. Make GA evidence generation deterministic and repeatable.
2. Make GA validation fail closed when required evidence, sign-offs, or release artifacts are missing.
3. Tighten the release/beta/GA document set so all artifacts describe the same exact state.
4. Reduce operator ambiguity in the path from pilot execution to GA decision.
5. Leave the repo in a state where running the real pilot and collecting real sign-offs is procedural, not improvisational.

Implementation priorities:

Priority 1: Evidence generation and validation
1. Add or improve scripts that assemble the scoped v1 GA evidence bundle from existing artifacts.
2. Add or improve validation scripts that fail when:
   - release evidence is still draft where approval is required,
   - sign-off placeholders remain,
   - required GA artifacts are missing,
   - status docs disagree with one another,
   - pilot evidence windows are empty but a doc claims readiness.
3. Prefer deterministic machine-readable outputs in `artifacts/` plus concise markdown summaries in `docs/`.

Priority 2: Release and decision guardrails
1. Tighten workflows and checklists so the release/GA path rejects incomplete evidence.
2. Ensure draft evidence, missing signatures, or missing sign-offs cannot be mistaken for approved launch posture.
3. If a workflow already enforces part of this, verify it and close the remaining gaps without duplicating logic.

Priority 3: Pilot-to-GA operating path
1. Make the path from:
   - beta pilot execution
   - to triage
   - to GA decision
   explicit and executable.
2. Update templates, runbooks, and status docs so the operator can follow one canonical path.
3. If human inputs are still required, isolate them behind explicit placeholders and checklist gates.

Priority 4: Status reconciliation
1. Reconcile `docs/README.md`, backlog status, release evidence, GA readiness review, and any relevant runbooks/templates.
2. Preserve the current truth:
   - technical validation is strong,
   - live pilot proof is still missing,
   - release evidence is not yet approved.

Expected deliverables:
1. New or updated scripts under `scripts/` for GA evidence assembly and validation.
2. New or updated workflows under `.github/workflows/` if needed to enforce the scoped v1 GA gates.
3. Updated docs that make the pilot-to-GA path deterministic:
   - release evidence
   - release checklist
   - beta/GA review artifacts
   - docs indexes
4. Tests for any new validation logic.
5. A short evidence summary in the final response listing:
   - what became automated,
   - what remains human-blocked,
   - exact commands to run next.

Required file touchpoints to inspect first:
1. `docs/ga-readiness-review-2026-03-08.md`
2. `docs/release-evidence.md`
3. `docs/release-checklist.md`
4. `docs/release-evidence-template.md`
5. `docs/application-completion-backlog.md`
6. `docs/README.md`
7. `.github/workflows/forge-release.yml`
8. `.github/workflows/forge-ci.yml`
9. `scripts/prepare-release-package.mjs`
10. `scripts/validate-release-evidence.mjs`
11. `scripts/resolve-release-metadata.mjs`
12. `scripts/run-beta-readiness-report.mjs`
13. `scripts/verify-doc-status-consistency.mjs`

Implementation guidance:
1. Prefer closing gaps with scripts and validation over adding more prose alone.
2. Do not duplicate state across many docs if one generated artifact can be canonical.
3. If a human approval is unavoidable, generate a precise blocked state and a checklist item rather than hand-waving.
4. If you discover an already-implemented guardrail, keep it and document it rather than replacing it.
5. Keep terminology consistent across all affected docs:
   - `Implemented`
   - `Validated`
   - `Ready for Execution`
   - `Executed`
   - `Approved`

Validation:
1. `npm run check`
2. `npm run verify:migrations:dr018`
3. `npm run test:e2e-local`
4. `npm run check:docs-status`
5. Any new unit/contract tests for validation scripts
6. Any new workflow or script dry-runs that can execute locally without fabricating pilot traffic

Exit criteria:
1. Scoped v1 GA artifacts are cross-consistent.
2. Release/GA validation fails closed on missing evidence or sign-offs.
3. The repo clearly distinguishes:
   - technically validated,
   - ready for execution,
   - executed,
   - approved.
4. No scope creep beyond `vscode_copilot` local stdio.
5. Remaining blockers, if any, are only real-world pilot traffic and human approvals.

Final response requirements:
1. Summarize the concrete changes.
2. List exact commands/workflows the operator must run next.
3. State what still cannot be completed without live pilot traffic or human sign-off.
4. Do not claim GA was reached unless the evidence actually supports that conclusion.
```
