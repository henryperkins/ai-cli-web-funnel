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

## Required Evidence Package

Create `docs/release-evidence.md` from `docs/release-evidence-template.md` and include:
1. exact commands and outcomes,
2. blockers/deferreds with owners and target dates,
3. migration notes (lock risk + rollback plan),
4. sign-off section marked `STATUS: APPROVED`.
5. beta outcomes (`go|blocked|no-go`) and unresolved blockers with owner/date.

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

## Distribution Channel Policy Checks (E9-S4)

1. `docs/distribution-and-upgrade-policy.md` is referenced by release owner.
2. `scripts/verify-distribution-policy.mjs --channel <stable|candidate|canary> --version <semver>` passes.
3. `artifacts/distribution-manifest.json` is generated and attached with release artifacts.

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
