# E9-S3 Plan: Release Checklist and Artifact Signatures

Story: `E9-S3`
Owner: Platform + Product
Priority: `P0`
Status: Not Started

## Objective

Define and operationalize a release checklist with required gate outputs and artifact integrity/signature controls for repeatable GA-quality releases.

## In Scope

1. Release checklist document with mandatory technical/governance gates.
2. Build artifact integrity/signature policy.
3. CI/release workflow enforcement for checklist completion.
4. Release evidence package template.

## Out of Scope

1. Distribution channel policy (`E9-S4`, P1).
2. Non-v1 packaging ecosystems.

## Implementation Steps

1. Draft release checklist.
- Include required commands, CI statuses, migration verification, governance drift, and incident readiness checks.

2. Define artifact integrity process.
- Specify artifact outputs, checksum/signature generation, and storage/retention.

3. Integrate with release workflow.
- Add release workflow steps for checklist validation and artifact verification.
- Fail release flow on missing required evidence.

4. Publish release evidence template.
- Include sections for test evidence, migration posture, deferred items, and sign-off owners.

5. Document policy.
- Link checklist from root/docs indexes and CI verification docs.

## File Touchpoints

1. `.github/workflows/` (release workflow updates)
2. `docs/` (new release checklist + template)
3. `docs/ci-verification.md`
4. `README.md`
5. `DECISION_LOG.md` (if release policy changes require governance note)

## Validation Commands

1. `npm run check`
2. `npm run verify:migrations:dr018`
3. `npm run test:e2e-local`
4. `npm run test:integration-db:docker`

## Exit Criteria

1. Release checklist exists and is enforceable in workflow.
2. Artifact integrity/signature process is documented and exercised.
3. Release evidence package can be produced end-to-end.
