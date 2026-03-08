# Forge Release Checklist

Status: Required for every release candidate and GA release
Last Updated: 2026-02-28

## Required Technical Gates

Run and record results (PASS/FAIL/BLOCKED with exact blocker text):
1. `npm run check`
2. `npm run verify:migrations:dr018`
3. `npm run test:e2e-local`
4. `npm run test:integration-db:docker`
5. `npm run run:retrieval-sync -- --mode dry-run --limit 25`
6. `npm run run:outbox -- --mode dry-run --limit 25`
7. `npm run run:outbox-dead-letter -- --action list --limit 25`
8. `npm run run:slo-rollup -- --mode dry-run --from <iso> --to <iso> --limit 100` (if DB available)
9. `npm run run:security-trust-gates -- --mode dry-run --action evaluate --window-from <iso> --window-to <iso> --trigger release-check` (if DB available)
10. `npm run run:security-promotion -- --mode dry-run --package-id <uuid> --reviewer-id <id> --evidence-ref <ticket-id>` (if DB available)

Recommended local helpers:
1. `npm run release:prepare -- --mode preflight --channel candidate --version <rc-version> --evidence docs/release-evidence.md`
2. `npm run release:apply-signoffs -- --file docs/release-evidence.md --release-manager "<name>" --security-reviewer "<name>" --qa-owner "<name>" --platform-owner "<name>" --approve --expected-version <rc-version>`
3. `npm run release:prepare -- --mode package --channel candidate --version <rc-version> --evidence docs/release-evidence.md`

## Required Evidence Package

Create `docs/release-evidence.md` from `docs/release-evidence-template.md` and include:
1. exact commands and outcomes,
2. blockers/deferreds with owners and target dates,
3. migration notes (lock risk + rollback plan),
4. exactly one `STATUS:` line:
   - use `STATUS: DRAFT` while assembling the evidence package,
   - replace it with `STATUS: APPROVED` only when all human sign-offs are complete.
5. completed human sign-offs with no placeholder values (for example no `<pending>` or `<name>` values) before release gating.
6. a `Release:` line that matches the version resolved by the release workflow.
7. beta outcomes (`go|blocked|no-go`) and unresolved blockers with owner/date.

## Artifact Integrity and Signature Controls

Required outputs:
1. source bundle artifact (`artifacts/forge-<channel>-<version>-<sha>.tar.gz`)
2. checksum manifest (`artifacts/release.sha256`)
3. detached signature (`artifacts/release.sha256.asc`)

Verification policy:
1. checksums must be generated inside release workflow,
2. checksum manifest must be signed by release signing key,
3. signature verification must pass in workflow before publish,
4. missing signing material is a hard release failure.
5. final release artifacts must be generated from a clean committed revision, not a dirty worktree.

## Distribution Channel Policy Checks (E9-S4)

1. `docs/distribution-and-upgrade-policy.md` is referenced by release owner.
2. `scripts/verify-distribution-policy.mjs --channel <stable|candidate|canary> --version <semver>` passes.
3. `scripts/resolve-release-metadata.mjs` resolves a channel/version pair before artifact generation:
   - `release` events derive `stable` version from the published tag,
   - `workflow_dispatch` for `candidate` and `canary` requires an explicit `release_version`.
4. `scripts/validate-release-evidence.mjs --file docs/release-evidence.md --expected-version <semver> --require-approved-status --require-complete-signoffs` passes.
5. `artifacts/distribution-manifest.json` is generated and attached with release artifacts.

## Governance and Scope Checks

1. `node scripts/verify-governance-drift.mjs` must pass.
2. AQ/MQ/DR status changes must not be silently promoted to Approved.
3. `DECISION_LOG.md` must include release-impacting scope changes.
4. For `E6-S4` closure, release evidence must reference the latest closure artifact in `docs/open-questions-resolution/` and its matching `DECISION_LOG.md` entry.

## Required Human Sign-Offs

1. Release Manager
2. Security Reviewer
3. QA Owner
4. Platform Owner

Release cannot proceed until all sign-offs are present in `docs/release-evidence.md`.
