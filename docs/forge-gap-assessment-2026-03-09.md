# Forge Gap Assessment

Date: `2026-03-09`
Question: How close is this repo to being "Forge - a CurseForge-style CLI addon manager"?

## Bottom Line

- Close to the repo's scoped v1 GA target: `~85%`
- Close to the broader public product vision: `~65%`

This repo is substantially beyond scaffold stage. The core control-plane APIs, install lifecycle engine, runtime verification path, catalog connectors, profile flows, retrieval stack, governance checks, and CI gates are implemented and locally green.

The remaining gap is mostly not foundational backend work. The main remaining work is:
1. live pilot execution and GA sign-off,
2. release evidence promotion from draft to approved,
3. broader client and adapter coverage,
4. a true end-user Forge CLI or packaged manager surface.

## Evidence Snapshot

Validated on `2026-03-09`:

1. `npm run check` -> PASS
2. `npm run test:e2e-local` -> PASS
3. `npm run verify:migrations:dr018` -> PASS

Repo evidence already states the release candidate is technically validated but still blocked on pilot traffic and sign-off:

1. `docs/ga-readiness-review-2026-03-08.md`
2. `docs/release-evidence.md`
3. `docs/application-completion-backlog.md`

## What Is Already Real

### 1. Discovery, search, and freshness APIs exist

The control plane exposes:

1. `GET /v1/packages`
2. `GET /v1/packages/:id`
3. `GET /v1/packages/freshness`
4. `POST /v1/packages/search`

Evidence:

1. `apps/control-plane/src/http-app.ts`
2. `apps/control-plane/src/catalog-routes.ts`

### 2. Catalog connector coverage is real

The repo contains working connector implementations for:

1. GitHub
2. npm
3. PyPI
4. docs/web inputs

Evidence:

1. `packages/catalog/src/sources/github-connector.ts`
2. `packages/catalog/src/sources/npm-connector.ts`
3. `packages/catalog/src/sources/pypi-connector.ts`
4. `packages/catalog/src/sources/docs-connector.ts`

### 3. The install lifecycle is implemented end to end

The API surface and service layer support:

1. plan
2. apply
3. verify
4. update
5. remove
6. rollback

The implementation also persists action state, attempt history, and audit rows with replay-safe behavior.

Evidence:

1. `apps/control-plane/src/http-app.ts`
2. `apps/control-plane/src/install-lifecycle.ts`

### 4. Profiles and bundle-style flows exist

The repo supports profile create/list/get/export/import/install flows with validation and run tracking.

Evidence:

1. `apps/control-plane/src/profile-routes.ts`
2. `apps/control-plane/src/profile-postgres-adapters.ts`

### 5. Runtime verification is not mocked away

The runtime daemon bootstrap covers:

1. local supervisor flow,
2. remote SSE hooks,
3. remote streamable HTTP hooks,
4. health validation,
5. scope sidecar ownership checks.

Evidence:

1. `apps/runtime-daemon/src/runtime-bootstrap.ts`
2. `apps/runtime-daemon/src/daemon-main.ts`
3. `apps/runtime-daemon/src/scope-sidecar.ts`

### 6. Retrieval and governance are real subsystems

The repo includes:

1. BM25 plus semantic hybrid retrieval,
2. outbox and dead-letter tooling,
3. trust gates and promotion logic,
4. SLO rollups and beta-readiness reporting.

Evidence:

1. `packages/ranking/src/retrieval-service.ts`
2. `packages/security-governance/src/index.ts`
3. `packages/security-governance/src/outbox-dispatcher.ts`
4. `packages/security-governance/src/slo-rollup.ts`

### 7. Quality gates are meaningful

CI runs:

1. typecheck,
2. tests,
3. local e2e,
4. governance checks,
5. migration verification,
6. integration-db Docker flow.

Evidence:

1. `.github/workflows/forge-ci.yml`
2. `tests/e2e/`
3. `tests/integration-db/`

## Why The Repo Is Not Yet The Full Product Vision

### 1. The GA support boundary is narrow

The v1 compatibility lock is explicitly:

1. client: `vscode_copilot`
2. mode: `local`
3. transport: `stdio`

That is a legitimate first shipping slice, but it is not yet a broad CLI addon-manager platform.

Evidence:

1. `docs/compatibility-matrix.md`
2. `packages/shared-contracts/src/install-lifecycle.ts`

### 2. There is no user-facing Forge CLI in this repo

This repository is mostly a private monorepo of services, adapters, packages, and operator scripts. It does not yet present a clear end-user command surface that behaves like "install manager first, platform internals second."

Evidence:

1. `package.json`
2. `scripts/`
3. `apps/control-plane/`
4. `apps/runtime-daemon/`

### 3. Live-product validation has not happened yet

The GA review is still blocked because the system has not seen pilot traffic. All KPI windows in the pre-pilot review are `insufficient_data`.

Evidence:

1. `docs/ga-readiness-review-2026-03-08.md`

### 4. Release execution is not finished

The release evidence is still `DRAFT`, with pending checksum/signature/sign-off work and final package generation still deferred.

Evidence:

1. `docs/release-evidence.md`

### 5. Some platform features are still intentionally deferred

The backlog still calls out next-wave work such as:

1. identity conflict review workflow,
2. profile overlays and team sharing controls,
3. SLO expansion to update/remove/rollback,
4. dashboards and alerts.

These are not all v1 blockers, but they are meaningful gaps versus the bigger "CurseForge-style manager" framing.

Evidence:

1. `docs/application-completion-backlog.md`

## Assessment By Scope

### Scoped v1 GA Target

Assessment: `~85% complete`

Why:

1. Core product loop exists.
2. CI and migration guardrails are in place.
3. Local technical validation is green.
4. Remaining blockers are mostly execution, evidence, and sign-off.

What still blocks this scope:

1. beta pilot execution,
2. post-pilot triage closure,
3. GA launch decision,
4. release evidence promotion out of draft.

### Broader CurseForge-Style Product Vision

Assessment: `~65% complete`

Why:

1. The engine exists.
2. The governed install lifecycle exists.
3. The runtime verification path exists.

But:

1. client coverage is narrow,
2. the end-user manager surface is thin,
3. public release and live traffic proof are missing,
4. ecosystem workflows are not yet broad enough to feel like a mature addon manager.

## Gap-To-GA Checklist

This checklist is split into two layers so scope does not get blurred.

### A. Must Close For Scoped v1 GA

- [ ] Execute `E10-S1` closed beta and capture the first non-zero KPI window.
  Evidence target: `docs/ga-readiness-review-<date>.md` with live counts for install/apply/verify and profile runs.
- [ ] Complete `E10-S2` triage and record disposition for high-severity pilot failures.
  Evidence target: triage artifact under `docs/` or `docs/immediate-execution-plans/phase-3/`.
- [ ] Complete `E10-S3` GA decision and collect required sign-offs.
  Evidence target: finalized GA launch report and signed review artifacts.
- [ ] Promote `docs/release-evidence.md` from `DRAFT` to approved evidence.
  Includes final package generation, checksum material, signature file, and human sign-offs.
- [ ] Cut and validate the signed candidate release artifact from the approved commit.
  Evidence target: `artifacts/forge-candidate-<version>-<commit>.tar.gz`, `artifacts/release.sha256`, `artifacts/release.sha256.asc`.

### B. Must Close To Fully Match The Broader Product Claim

- [ ] Ship a real user-facing Forge CLI or equivalent manager UX.
  The repo currently looks like platform internals plus operator scripts, not a consumer-facing addon manager.
- [ ] Add at least one more GA adapter/client beyond `vscode_copilot` local stdio.
  Without this, the product feels like a specialized integration path rather than a platform.
- [ ] Turn remote runtime paths from "hooks exist" into supported product paths where appropriate.
  Current remote SSE and streamable HTTP flows are planned, not GA.
- [ ] Publish the install and upgrade story as an end-user workflow, not just internal release policy.
  Users should have a canonical Forge install/update/remove entry point.
- [ ] Add ecosystem-facing release and distribution proof.
  The platform needs a visible package/release surface that matches the manager framing.
- [ ] Implement higher-order catalog governance workflows.
  Start with identity conflict review and lineage anomaly handling.
- [ ] Implement team-grade profile controls.
  Profile overlays, sharing, and policy gates are still backlog items.
- [ ] Extend operational visibility beyond the current baseline.
  Add dashboards, alerts, and update/remove/rollback SLO coverage.

## Recommended Positioning Right Now

Accurate today:

1. "Forge is the control plane and runtime foundation for a governed CLI addon manager."
2. "Forge already supports discovery, planning, install/apply/verify, rollback, profiles, and runtime verification for the `vscode_copilot` local path."

Too broad today without qualification:

1. "Forge is already a full CurseForge-style CLI addon manager."

The repo is close enough to support the first phrasing with confidence. The second phrasing needs the checklist above, especially live pilot proof and broader product surface.
