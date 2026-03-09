# Build Prompt: CurseForge-Style Manager Productization

Use this prompt with an implementation agent to push Forge from a strong backend/control-plane foundation toward a real CurseForge-style CLI addon manager product.

```text
You are an implementation agent working in /home/azureuser/ai-cli-web-funnel.

Mission:
Turn Forge from an implementation-heavy control-plane/runtime foundation into a real user-facing, CurseForge-style CLI addon manager while preserving the current scoped v1 path.

North-star loop:
1. discover
2. plan
3. install
4. verify

Current ground truth (do not reinterpret):
1. Forge already has substantial backend foundations:
   - catalog discovery/search/freshness APIs,
   - install lifecycle APIs and service logic,
   - profile flows,
   - runtime daemon,
   - hybrid retrieval,
   - governance/trust-gate and SLO tooling.
2. Current GA compatibility is intentionally narrow:
   - client: `vscode_copilot`
   - mode: `local`
   - transport: `stdio`
3. There is no real end-user Forge CLI in this repo today.
4. The repo is still a private monorepo and does not yet present a clean consumer-facing package manager surface.
5. Catalog source coverage already exists for GitHub, npm, PyPI, and docs/web ingestion.
6. Profile and governance foundations exist, but broader product workflows are still incomplete.
7. The product vision is bigger than the current v1 GA slice. Do not blur those two scopes.

What “done” means for this mission:
1. A user can interact with Forge as a product, not just as backend internals.
2. The repo gains a real manager surface for core tasks:
   - discover/search,
   - inspect/show,
   - plan,
   - install/apply,
   - verify,
   - update,
   - remove,
   - rollback,
   - profile import/export/install.
3. The docs and release posture describe a manager product truthfully, without overclaiming unsupported paths.
4. The current scoped v1 path remains stable and test-covered.

Non-negotiable constraints:
1. Do not regress the current `vscode_copilot` local stdio path.
2. Do not silently promote unsupported clients or transports to `ga`.
3. Preserve idempotency, migration, privacy, and secret-handling invariants.
4. Keep migrations additive and forward-only.
5. Do not weaken governance or trust-gate behavior to make the UX appear simpler.
6. Do not fake public adoption, releases, pilot metrics, or GA support.
7. Any newly added support level must be explicitly documented as:
   - `ga`
   - `preview`
   - `planned`
   based on actual evidence.

Primary product gaps to close:
1. Missing user-facing Forge CLI.
2. Weak end-user install/distribution story.
3. Narrow client/adaptor coverage.
4. Missing higher-order ecosystem workflows that make the product feel like a manager rather than a service backend.
5. Incomplete team-grade profile controls and observability story.

Execution strategy:
Prioritize the highest-leverage productization work first. Do not spend the whole pass on internal abstractions if a real user journey still does not exist at the end.

Priority 1: Ship a real Forge CLI
1. Add a first-class CLI package or app with a `forge` command.
2. The CLI should expose, at minimum:
   - `forge search`
   - `forge show`
   - `forge plan`
   - `forge install`
   - `forge verify`
   - `forge update`
   - `forge remove`
   - `forge rollback`
   - `forge profile export`
   - `forge profile import`
   - `forge profile install`
3. The CLI should wrap the existing control-plane/runtime behavior rather than re-implementing business logic.
4. Add sensible output for humans first, while preserving machine-readable options where useful.

Priority 2: Create a real end-user workflow
1. Add user configuration for connecting the CLI to the control-plane/runtime.
2. Add install and quickstart docs that show a real end-to-end journey.
3. Add packaging/distribution mechanics so the CLI can be built, packaged, and validated as a user-facing artifact.
4. The public-facing workflow should feel like:
   - install Forge,
   - search addons,
   - plan one,
   - install it,
   - verify it,
   - manage a profile.

Priority 3: Expand support beyond a single narrow client path
1. Introduce or solidify the adapter/client abstraction needed to support more than one client path cleanly.
2. Add at least one concrete next support step beyond the current GA path.
3. If a full second GA adapter is too large for one pass, then:
   - implement the abstraction,
   - land one explicit preview-grade path,
   - document it honestly in the compatibility matrix,
   - do not label it GA without evidence.

Priority 4: Add product-grade ecosystem workflows
1. Implement catalog anomaly and identity-conflict review workflows.
2. Expose operator or admin surfaces for reviewing and resolving catalog governance issues.
3. Tighten the story around package lineage, freshness, and trust posture as user-visible product signals where appropriate.

Priority 5: Upgrade team workflows
1. Add profile overlays or equivalent environment-specific profile composition.
2. Add stronger profile ownership/sharing/policy controls where the current baseline is thin.
3. Keep these additions deterministic and audit-friendly.

Priority 6: Extend operational product confidence
1. Extend SLO/metric coverage to update/remove/rollback flows if missing.
2. Add the minimum viable dashboards, alerts, or generated operator artifacts needed to support the manager as a product.
3. Ensure alert-to-runbook paths are explicit.

Expected deliverables:
1. A new user-facing Forge CLI package/app and its tests.
2. New or updated docs for:
   - install/quickstart
   - CLI usage
   - compatibility matrix
   - release/distribution story
   - runbooks for new product paths
3. Any required scripts/workflows for packaging and validating the CLI artifact.
4. Any required schema or service changes to support new user-facing workflows.
5. Updated backlog/status docs to reflect what moved from planned to implemented or preview.

Required file touchpoints to inspect first:
1. `package.json`
2. `README.md`
3. `docs/compatibility-matrix.md`
4. `docs/application-completion-backlog.md`
5. `docs/forge-gap-assessment-2026-03-09.md`
6. `apps/control-plane/src/http-app.ts`
7. `apps/control-plane/src/install-lifecycle.ts`
8. `apps/control-plane/src/profile-routes.ts`
9. `apps/runtime-daemon/src/runtime-bootstrap.ts`
10. `packages/shared-contracts/src/install-lifecycle.ts`
11. `packages/catalog/src/sources/`
12. Existing tests in `tests/e2e/`, `tests/integration/`, `tests/integration-db/`

Implementation guidance:
1. Bias toward delivering a coherent user journey over adding more internal plumbing with no visible product surface.
2. Reuse existing HTTP APIs and runtime services wherever possible.
3. Keep the CLI and product docs honest about support levels.
4. If some larger productization goals cannot be completed in one pass, land the highest-value slice and leave an explicit dated follow-on plan.
5. Prefer one strong CLI path over many half-implemented entry points.
6. Do not break current tests to land new UX.

Minimum validation:
1. `npm run check`
2. `npm run verify:migrations:dr018`
3. `npm run test:e2e-local`
4. Any new CLI-specific tests
5. At least one end-to-end local flow that exercises the new Forge CLI across the existing install loop
6. Updated docs indexes and compatibility matrix consistency checks

Success criteria:
1. A developer can use a real `forge` command from this repo to drive the core loop.
2. The repo tells a truthful product story that is materially closer to a CurseForge-style manager.
3. The manager surface is no longer hidden behind backend internals and operator scripts alone.
4. The current v1 GA path remains stable.
5. Any newly added non-GA support is clearly labeled and tested at its real maturity level.

If forced to trade scope:
1. Prioritize:
   - real Forge CLI,
   - packaging/distribution story,
   - one coherent end-user install/verify flow.
2. Defer:
   - secondary ecosystem polish,
   - lower-value abstractions,
   - broad multi-client ambition without a usable first CLI experience.

Final response requirements:
1. Summarize the user-facing product changes first.
2. Call out what is now materially closer to the CurseForge-style claim.
3. State which support levels remain preview or planned.
4. List exact commands a user can run to try the new manager flow locally.
```
