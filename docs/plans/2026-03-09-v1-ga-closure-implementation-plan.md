# v1 GA Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all code/script/doc gaps for scoped v1 GA, leaving only live pilot traffic and human sign-offs as remaining blockers.

**Architecture:** Compose existing validation scripts (`validate-release-evidence.mjs`, `verify-doc-status-consistency.mjs`) into a single fail-closed GA readiness gate. Add a canonical pilot-to-GA runbook. Reconcile docs/README.md.

**Tech Stack:** Node.js ESM scripts, Vitest contract tests, markdown docs.

---

### Task 1: Create `scripts/validate-ga-readiness.mjs`

**Files:**
- Create: `scripts/validate-ga-readiness.mjs`

Single GA readiness validation script that composes all existing checks:
1. Release evidence structural validity
2. Release evidence approval status + sign-offs (blocked if not approved)
3. Doc-status consistency
4. Beta readiness report artifact presence and go/no-go
5. GA readiness review existence
6. Summary with pass/fail/blocked per check

Exits 0 only when all checks pass. Reports `blocked` for human-dependent gates.

### Task 2: Add contract tests for GA readiness validation

**Files:**
- Create: `tests/contract/ga-readiness-validation.contract.test.ts`

Tests:
1. Passes when all artifacts present and approved
2. Reports blocked when evidence is DRAFT
3. Reports blocked when sign-offs are placeholders
4. Reports blocked when beta report missing
5. Reports blocked when beta report go_no_go != 'go'
6. Fails when doc-status consistency fails

### Task 3: Wire npm scripts

**Files:**
- Modify: `package.json`

Add `"validate:ga-readiness": "node scripts/validate-ga-readiness.mjs"`.

### Task 4: Create pilot-to-GA runbook

**Files:**
- Create: `docs/runbooks/pilot-to-ga-operations.md`

Canonical operator path: pilot execution -> KPI collection -> triage -> GA decision -> sign-off -> release.

### Task 5: Reconcile docs/README.md

**Files:**
- Modify: `docs/README.md`

Update delivery state to reflect 2026-03-09 posture including GA readiness validation gate.

### Task 6: Verify green baseline

Run: `npm run check`, `npm run verify:migrations:dr018`, `npm run test:e2e-local`, `node scripts/validate-ga-readiness.mjs`
