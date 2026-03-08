# Phase 3 Plan: E9-S4 Distribution and Upgrade Policy

Story: `E9-S4`
Owner: Platform
Priority: `P1` (release-readiness critical)
Status: Validated (2026-03-08)

## Objective

Define and enforce an executable distribution policy for `stable`, `candidate`, and `canary` channels, including upgrade/rollback/deprecation rules and artifact signature expectations.

## In Scope

1. New distribution policy document with channel semantics and upgrade rules.
2. Release workflow guardrails validating channel/version compatibility.
3. Signed artifact expectations for all distributed bundles.
4. Release checklist alignment for distribution evidence.

## Out of Scope

1. Broadly publishing all workspace packages.
2. New package manager ecosystems outside the approved release artifact path.

## Implementation Steps

1. Publish `docs/distribution-and-upgrade-policy.md`.
2. Add release workflow inputs and validation logic for channel/version policy.
3. Emit channel-aware distribution manifest with checksums/signature references.
4. Update release checklist and evidence template to capture distribution policy compliance.

## File Touchpoints

1. `docs/distribution-and-upgrade-policy.md`
2. `.github/workflows/forge-release.yml`
3. `scripts/verify-distribution-policy.mjs`
4. `docs/release-checklist.md`
5. `docs/release-evidence-template.md`

## Validation

1. `node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0-rc.1`
2. `node scripts/verify-distribution-policy.mjs --channel stable --version 0.2.0`
3. Release workflow dry-run via `workflow_dispatch` inputs.

## Exit Criteria

1. Distribution channels and upgrade behavior are explicit and enforceable.
2. Release workflow fails fast on channel/version policy violations.
3. Artifact signature verification remains mandatory for all channels.

## Execution Evidence (2026-03-08)

### Changed files

1. `docs/distribution-and-upgrade-policy.md` (landed Wave 10)
2. `.github/workflows/forge-release.yml` (landed Wave 10)
3. `scripts/verify-distribution-policy.mjs` (landed Wave 10)
4. `docs/release-checklist.md` (landed Wave 10)
5. `docs/release-evidence-template.md` (landed Wave 10)
6. `docs/release-evidence.md` (new: populated release evidence with all gate results)
7. `artifacts/distribution-manifest.json` (new: generated via policy validator)
8. `artifacts/forge-candidate-0.2.0-rc.1-db5ee59.tar.gz` (new: source archive)
9. `artifacts/release.sha256` (new: checksum manifest)

### Validation commands and results

| Command | Result |
| --- | --- |
| `node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0-rc.1` | PASS |
| `node scripts/verify-distribution-policy.mjs --channel stable --version 0.2.0` | PASS |
| `node scripts/verify-distribution-policy.mjs --channel stable --version 0.2.0-rc.1` | PASS (correctly rejected) |
| `node scripts/verify-distribution-policy.mjs --channel candidate --version 0.2.0` | PASS (correctly rejected) |
| `node scripts/resolve-release-metadata.mjs --event-name workflow_dispatch --release-channel candidate --release-version 0.2.0-rc.1` | PASS |
| `node scripts/validate-release-evidence.mjs --file docs/release-evidence.md --expected-version 0.2.0-rc.1` | PASS (draft evidence is structurally valid) |
| Full artifact generation (archive + checksum + manifest) | PASS |
| Release gate approval path | VALIDATED, not executed: pending final sign-offs and CI-only GPG signature |

### Deferred items

| Item | Owner | Target |
| --- | --- | --- |
| GPG detached signature (`release.sha256.asc`) | Platform Ops | CI-only; enforced by workflow `FORGE_RELEASE_GPG_PRIVATE_KEY_B64` secret |
| Final release approval (`STATUS: APPROVED` + completed sign-offs) | Release Manager + Security + QA + Platform | Required before release workflow can pass |
