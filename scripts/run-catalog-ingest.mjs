#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { Pool } from 'pg';
import { createCatalogIngestService } from '@forge/catalog';
import { createCatalogPostgresAdapters } from '@forge/catalog/postgres-adapters';
import { normalizeGitHubRepos } from '@forge/catalog/sources/github-connector';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function logEvent(eventName, payload) {
  console.log(
    JSON.stringify({
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      payload
    })
  );
}

function stableJson(value) {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value.normalize('NFC'));
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key.normalize('NFC'))}:${stableJson(nested)}`)
      .join(',')}}`;
  }

  return 'null';
}

function deterministicMergeRunId(run) {
  if (typeof run.merge_run_id === 'string' && run.merge_run_id.trim().length > 0) {
    return run.merge_run_id.trim();
  }

  const digest = createHash('sha256')
    .update(
      stableJson({
        occurred_at: run.occurred_at,
        source_snapshot: run.source_snapshot ?? {},
        candidates: run.candidates ?? []
      }),
      'utf8'
    )
    .digest('hex')
    .slice(0, 16);

  return `merge-${digest}`;
}

function normalizeInput(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('catalog_ingest_input_invalid: expected JSON object or array');
  }

  const root = raw;
  if (Array.isArray(root.runs)) {
    return root.runs.map((run) => ({
      ...run,
      ...(run.source_snapshot ? {} : root.source_snapshot ? { source_snapshot: root.source_snapshot } : {}),
      ...(run.detected_by ? {} : root.detected_by ? { detected_by: root.detected_by } : {}),
      ...(run.review_sla_hours ? {} : root.review_sla_hours ? { review_sla_hours: root.review_sla_hours } : {}),
      ...(run.registry_to_github_map
        ? {}
        : root.registry_to_github_map
          ? { registry_to_github_map: root.registry_to_github_map }
          : {})
    }));
  }

  return [root];
}

function summarize(result) {
  return {
    merge_run_id: result.merge_run_id,
    requires_manual_review: result.requires_manual_review,
    resolution_path: result.resolution_path,
    package_id: result.package_candidate?.package_id ?? null,
    alias_count: result.alias_candidates.length,
    field_lineage_count: result.field_lineage.length,
    conflict_count: result.conflicts.length
  };
}

const mode = (getArg('--mode') ?? 'dry-run').toLowerCase();
if (mode !== 'dry-run' && mode !== 'apply') {
  console.error('Invalid --mode. Expected dry-run or apply.');
  process.exit(1);
}

const inputPath = getArg('--input');
if (!inputPath) {
  console.error('--input is required and must point to a JSON file.');
  process.exit(1);
}

const sourceMode = (getArg('--source') ?? '').toLowerCase();

let parsed;
try {
  parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (error) {
  console.error(
    `Failed to read/parse input JSON: ${error instanceof Error ? error.message : 'unknown_error'}`
  );
  process.exit(1);
}

if (sourceMode === 'github') {
  const repos = Array.isArray(parsed) ? parsed : parsed.repos ?? parsed.items ?? [];
  const toolKind = getArg('--tool-kind') ?? 'mcp';
  const { candidates, skipped } = normalizeGitHubRepos(repos, { toolKind });
  if (skipped.length > 0) {
    logEvent('catalog_ingest.github_skipped', { count: skipped.length, skipped });
  }
  parsed = {
    merge_run_id: `github-${createHash('sha256').update(JSON.stringify(repos.map((r) => r.id))).digest('hex').slice(0, 16)}`,
    occurred_at: new Date().toISOString(),
    source_snapshot: { source: 'github', repo_count: repos.length },
    detected_by: 'github-connector',
    candidates
  };
}

const runs = normalizeInput(parsed);
if (runs.length === 0) {
  console.error('No ingest runs found in input JSON.');
  process.exit(1);
}

const ingestService = createCatalogIngestService();

const runResults = [];
for (const run of runs) {
  const mergeRunId = deterministicMergeRunId(run);
  const occurredAt =
    typeof run.occurred_at === 'string' && run.occurred_at.trim().length > 0
      ? run.occurred_at
      : new Date().toISOString();

  const result = ingestService.ingest({
    ...run,
    merge_run_id: mergeRunId,
    occurred_at: occurredAt
  });

  runResults.push(result);
}

if (mode === 'dry-run') {
  for (const result of runResults) {
    logEvent('catalog_ingest.dry_run_result', summarize(result));
  }

  logEvent('catalog_ingest.dry_run_completed', {
    run_count: runResults.length,
    manual_review_count: runResults.filter((result) => result.requires_manual_review).length
  });

  process.exit(0);
}

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required in apply mode.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl
});

const db = {
  async query(sql, params = []) {
    const result = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  },
  async withTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        async query(sql, params = []) {
          const result = await client.query(sql, params);
          return {
            rows: result.rows,
            rowCount: result.rowCount
          };
        }
      };

      const output = await callback(tx);
      await client.query('COMMIT');
      return output;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

const adapters = createCatalogPostgresAdapters({ db });

try {
  for (const result of runResults) {
    const persisted = await adapters.persistIngestResult(result);

    logEvent('catalog_ingest.applied_result', {
      ...summarize(result),
      persisted_package_id: persisted.package_id,
      queued_conflicts: persisted.queued_conflicts
    });
  }

  logEvent('catalog_ingest.apply_completed', {
    run_count: runResults.length,
    manual_review_count: runResults.filter((result) => result.requires_manual_review).length
  });
} catch (error) {
  logEvent('catalog_ingest.apply_failed', {
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
