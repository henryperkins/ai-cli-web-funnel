# Phase 3 Plan: E9-S4 Distribution and Upgrade Policy

Story: `E9-S4`
Owner: Platform
Priority: `P1` (release-readiness critical)
Status: In Progress (2026-02-28)

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
