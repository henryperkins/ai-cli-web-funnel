# Compatibility Matrix (v1)

Status: Active
Last Updated: 2026-02-28

This matrix defines the v1 support boundary for clients, modes, and transports.

## Matrix

| client | mode | transport | support_level | notes |
| --- | --- | --- | --- | --- |
| `vscode_copilot` | `local` | `stdio` | `ga` | Primary v1 path; install/update/remove/rollback/verify supported. |
| `vscode_copilot` | `remote` | `sse` | `planned` | Runtime flags/hooks exist; not in GA adapter scope. |
| `vscode_copilot` | `remote` | `streamable-http` | `planned` | Runtime flags/hooks exist; not in GA adapter scope. |
| `other_client` | `local` | `stdio` | `planned` | No GA adapter implementation in this repo baseline. |

## Scope Lock

v1 GA adapter scope is explicitly locked to:
1. client: `vscode_copilot`
2. mode: `local`
3. transport: `stdio`

No additional GA adapter is implied by scaffolded runtime hooks.

## Change Control

Any support-level promotion to `ga` requires:
1. shared adapter contract tests,
2. e2e + integration-db evidence,
3. runbook troubleshooting updates,
4. `DECISION_LOG.md` entry and compatibility matrix update in the same change.
