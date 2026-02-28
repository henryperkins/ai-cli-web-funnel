#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { Pool } from 'pg';
import { createCatalogIngestService } from '@forge/catalog';
import { createCatalogPostgresAdapters } from '@forge/catalog/postgres-adapters';
import {
  DocsSourceConnectorError,
  runDocsConnector
} from '@forge/catalog/sources/docs-connector';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function parsePositiveInt(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
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

function digestHex(value) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
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

function sourceItems(parsed, keys) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  for (const key of keys) {
    if (Array.isArray(parsed?.[key])) {
      return parsed[key];
    }
  }

  return [];
}

function summarizeRunResult(result) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const mode = (getArg('--mode') ?? 'dry-run').toLowerCase();
if (mode !== 'dry-run' && mode !== 'apply') {
  console.error('Invalid --mode. Expected dry-run or apply.');
  process.exit(1);
}

const source = (getArg('--source') ?? 'docs').toLowerCase();
if (source !== 'docs') {
  console.error('Only --source docs is currently supported by reconciliation runner.');
  process.exit(1);
}

const inputPath = getArg('--input');
if (!inputPath) {
  console.error('--input is required and must point to a JSON file.');
  process.exit(1);
}

const maxAttempts = Math.min(10, parsePositiveInt(getArg('--max-attempts'), 3));
const retryBackoffMs = Math.min(60_000, parsePositiveInt(getArg('--retry-backoff-ms'), 500));
const staleAfterMinutes = Math.min(10_080, parsePositiveInt(getArg('--stale-after-minutes'), 1_440));

let parsed;
try {
  parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (error) {
  console.error(
    `Failed to read/parse input JSON: ${error instanceof Error ? error.message : 'unknown_error'}`
  );
  process.exit(1);
}

const docs = sourceItems(parsed, ['docs', 'documents', 'items']);
const urls = Array.isArray(parsed?.urls)
  ? parsed.urls.filter((entry) => typeof entry === 'string')
  : [];
const toolKind = getArg('--tool-kind') ?? 'mcp';

if (docs.length === 0 && urls.length === 0) {
  console.error('Reconciliation input must include docs/documents/items array or urls array.');
  process.exit(1);
}

const runHash = digestHex({
  source,
  mode,
  docs,
  urls
});
const runId = (getArg('--run-id') ?? `reconcile-${source}-${runHash.slice(0, 16)}`).trim();
const startedAt = new Date().toISOString();

const ingestService = createCatalogIngestService();

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (mode === 'apply' && !databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required in apply mode.');
  process.exit(1);
}

const pool =
  mode === 'apply'
    ? new Pool({
        connectionString: databaseUrl
      })
    : null;

const adapters =
  pool !== null
    ? createCatalogPostgresAdapters({
        db: {
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
        }
      })
    : null;

let mergeRunId = null;
let finalStatus = 'failed';
let failureClass = null;
let failureMessage = null;
let completedAt = startedAt;
let attemptsUsed = 0;
let reconciliationRecorded = false;

try {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    try {
      logEvent('catalog_reconciliation.attempt_started', {
        run_id: runId,
        source,
        mode,
        attempt,
        max_attempts: maxAttempts
      });

      const { normalized, fetch_metadata: fetchMetadata } = await runDocsConnector(
        {
          ...(docs.length > 0 ? { docs } : {}),
          ...(urls.length > 0 ? { urls } : {})
        },
        {
          toolKind
        }
      );

      if (normalized.skipped.length > 0) {
        logEvent('catalog_reconciliation.docs_skipped', {
          run_id: runId,
          source,
          count: normalized.skipped.length,
          skipped: normalized.skipped
        });
      }

      mergeRunId = `docs-reconcile-${digestHex(
        normalized.candidates
          .map((candidate) => ({
            source_name: candidate.source_name,
            package_slug: candidate.package_slug ?? null,
            registry_package_locator: candidate.registry_package_locator ?? null,
            source_updated_at: candidate.source_updated_at ?? null
          }))
          .sort((left, right) =>
            String(left.registry_package_locator).localeCompare(String(right.registry_package_locator))
          )
      ).slice(0, 16)}`;

      const occurredAt = new Date().toISOString();
      const ingestResult = ingestService.ingest({
        merge_run_id: mergeRunId,
        occurred_at: occurredAt,
        source_snapshot: {
          source: 'docs',
          mode,
          doc_count: docs.length,
          url_count: urls.length,
          fetched_count: fetchMetadata.total_fetched,
          run_id: runId
        },
        detected_by: 'docs-reconciliation-runner',
        candidates: normalized.candidates
      });

      if (mode === 'dry-run') {
        logEvent('catalog_reconciliation.dry_run_result', {
          run_id: runId,
          ...summarizeRunResult(ingestResult)
        });
      } else {
        if (!adapters) {
          throw new Error('catalog_reconciliation_failed: adapters_unavailable');
        }

        const persisted = await adapters.persistIngestResult(ingestResult);

        if (adapters.recordSourceFreshness) {
          await adapters.recordSourceFreshness({
            source_name: source,
            status: 'succeeded',
            stale_after_minutes: staleAfterMinutes,
            last_attempt_at: occurredAt,
            last_success_at: occurredAt,
            merge_run_id: mergeRunId,
            failure_class: null,
            failure_message: null
          });
        }

        logEvent('catalog_reconciliation.apply_result', {
          run_id: runId,
          ...summarizeRunResult(ingestResult),
          persisted_package_id: persisted.package_id,
          queued_conflicts: persisted.queued_conflicts
        });
      }

      finalStatus = 'succeeded';
      failureClass = null;
      failureMessage = null;
      completedAt = new Date().toISOString();

      if (adapters?.recordReconciliationRun) {
        const runWrite = await adapters.recordReconciliationRun({
          run_id: runId,
          run_hash: runHash,
          source_name: source,
          mode,
          status: 'succeeded',
          attempts: attempt,
          merge_run_id: mergeRunId,
          started_at: startedAt,
          completed_at: completedAt,
          details: {
            stale_after_minutes: staleAfterMinutes,
            dry_run: mode === 'dry-run'
          }
        });

        if (runWrite.replayed) {
          logEvent('catalog_reconciliation.replayed', {
            run_id: runId,
            run_hash: runHash,
            status: 'succeeded'
          });
        }

        reconciliationRecorded = true;
      }

      break;
    } catch (error) {
      failureClass =
        error instanceof DocsSourceConnectorError
          ? error.failure_class
          : 'catalog_reconciliation_failed';
      failureMessage = error instanceof Error ? error.message : 'unknown_error';
      completedAt = new Date().toISOString();

      logEvent('catalog_reconciliation.attempt_failed', {
        run_id: runId,
        source,
        mode,
        attempt,
        max_attempts: maxAttempts,
        failure_class: failureClass,
        error_message: failureMessage
      });

      if (attempt === maxAttempts) {
        break;
      }

      await sleep(retryBackoffMs * attempt);
    }
  }

  if (finalStatus !== 'succeeded' && adapters?.recordSourceFreshness) {
    await adapters.recordSourceFreshness({
      source_name: source,
      status: 'failed',
      stale_after_minutes: staleAfterMinutes,
      last_attempt_at: completedAt,
      last_success_at: null,
      merge_run_id: mergeRunId,
      failure_class: failureClass,
      failure_message: failureMessage
    });
  }

  if (!reconciliationRecorded && adapters?.recordReconciliationRun) {
    const runWrite = await adapters.recordReconciliationRun({
      run_id: runId,
      run_hash: runHash,
      source_name: source,
      mode,
      status: finalStatus === 'succeeded' ? 'succeeded' : 'failed',
      attempts: Math.max(1, attemptsUsed),
      merge_run_id: mergeRunId,
      started_at: startedAt,
      completed_at: completedAt,
      details: {
        stale_after_minutes: staleAfterMinutes,
        failure_class: failureClass,
        failure_message: failureMessage
      }
    });

    if (runWrite.replayed) {
      logEvent('catalog_reconciliation.replayed', {
        run_id: runId,
        run_hash: runHash,
        status: finalStatus
      });
    }
  }

  logEvent('catalog_reconciliation.completed', {
    run_id: runId,
    source,
    mode,
    status: finalStatus,
    failure_class: failureClass,
    error_message: failureMessage,
    merge_run_id: mergeRunId,
    started_at: startedAt,
    completed_at: completedAt
  });

  if (finalStatus !== 'succeeded') {
    process.exitCode = 1;
  }
} finally {
  if (pool) {
    await pool.end();
  }
}
