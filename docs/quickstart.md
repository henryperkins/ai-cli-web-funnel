# Forge CLI Quickstart

## Prerequisites

1. Node.js 22+
2. A running Forge control-plane (`npm run run:control-plane` requires `FORGE_DATABASE_URL` and migrations applied)

## Install

From the monorepo root:

```bash
npm install
npm run build
```

## Start the control-plane

```bash
export FORGE_DATABASE_URL="postgresql://..."
npm run run:control-plane
```

The server starts on `http://localhost:8787` by default.

## Run the CLI

From the monorepo root:

```bash
npm run forge -- <command>
```

Or directly:

```bash
node apps/forge-cli/bin/forge.mjs <command>
```

## Initialize the CLI

Run first-time setup once:

```bash
npm run forge -- init
```

This writes `~/.forge/config.json` with a stable solo `org_id`, `http://localhost:8787` as the control-plane URL, and a safe default solo policy:

```json
{
  "mcp_enabled": true,
  "server_allowlist": [],
  "block_flagged": true,
  "permission_caps": {
    "maxPermissions": 10,
    "disallowedPermissions": []
  }
}
```

Use `npm run forge -- init --path ./forge-config.json` to write a different config file, or `--force` to replace an existing config.

## Core workflow

### 1. Discover

Search the addon catalog:

```bash
npm run forge -- search "mcp server fetch"
```

List all packages:

```bash
npm run forge -- list
```

Show package details:

```bash
npm run forge -- show <package_id>
```

### 2. Plan

Create an install plan (accepts UUID or exact slug):

```bash
npm run forge -- plan <package_id_or_exact_slug>
```

If you do not know the exact slug, search first and then retry with the returned `package_slug` or `package_id`:

```bash
npm run forge -- search "mcp server fetch"
```

By default the CLI loads declared permissions from package metadata before creating the plan. If the package does not publish permission metadata, the command fails closed and asks you to provide an explicit override:

```bash
npm run forge -- plan <package> --permissions read:config,write:config
```

### 3. Install

Apply the plan:

```bash
npm run forge -- install <plan_id>
```

### 4. Verify

Verify the addon is callable at runtime:

```bash
npm run forge -- verify <plan_id>
```

### 5. Manage

Check status:

```bash
npm run forge -- status <plan_id>
```

Update:

```bash
npm run forge -- update <plan_id>
```

Remove:

```bash
npm run forge -- remove <plan_id>
```

Rollback a failed operation:

```bash
npm run forge -- rollback <plan_id>
```

## Profiles

List profiles:

```bash
npm run forge -- profile list
```

Export a profile to a file:

```bash
npm run forge -- profile export <profile_id> --output my-profile.json
```

Import a profile:

```bash
npm run forge -- profile import my-profile.json
```

Install all packages in a profile:

```bash
npm run forge -- profile install <profile_id> --mode apply_verify
```

Profile install resolves declared permissions per package before creating plans. Packages without permission metadata fail closed in the install run output instead of being planned with an empty permission set.

## Options

All commands support:

| Flag | Description |
|------|-------------|
| `--path <file>` | Config path for `init` and config loading (default: `FORGE_CONFIG` env or `~/.forge/config.json`) |
| `--force` | Overwrite existing config for `init` |
| `--url <url>` | Control-plane URL override (default: `FORGE_URL` env, config, or `http://localhost:8787`) |
| `--org-id <id>` | Org ID override for `plan` and `profile install` |
| `--org-policy-file <file>` | Org policy JSON override for `plan` and `profile install` |
| `--permissions <p1,p2>` | Optional explicit permissions override for `plan` |
| `--json` | Output raw JSON instead of formatted tables |
| `--help` | Show help |
| `--version` | Show version |

The CLI resolves org context and URL in this order: explicit flags, environment variables, user config, then built-in solo defaults. Supported environment variables are `FORGE_CONFIG`, `FORGE_ORG_ID`, `FORGE_ORG_POLICY_FILE`, and `FORGE_URL`.

For advanced use, keep a separate policy file and pass it explicitly:

```bash
npm run forge -- plan <package_id_or_exact_slug> --org-id my-org --org-policy-file ./org-policy.json
```

## Catalog freshness

Check source connector health:

```bash
npm run forge -- freshness
```

## Health check

```bash
npm run forge -- health
```

## Support level

The Forge CLI is at `preview` support level. It wraps the control-plane HTTP API and requires a running server. The GA-supported path remains `vscode_copilot` local stdio (see `docs/compatibility-matrix.md`).
