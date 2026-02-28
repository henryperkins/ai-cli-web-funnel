#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { createPostgresDeadLetterReplayService } from '@forge/security-governance';

const VALID_ACTIONS = new Set(['list', 'requeue']);

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function parseInteger(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function isConfirmEnabled(value) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
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

const action = (getArg('--action') ?? 'list').toLowerCase();
if (!VALID_ACTIONS.has(action)) {
  console.error(`Invalid --action "${action}". Expected list or requeue.`);
  process.exit(1);
}

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required.');
  process.exit(1);
}

if (action === 'requeue' && !isConfirmEnabled(getArg('--confirm'))) {
  console.error(
    'Requeue requires explicit confirmation. Re-run with --confirm true to mutate dead-letter rows.'
  );
  process.exit(1);
}

const filters = {
  ...(getArg('--event-type') ? { event_type: getArg('--event-type') } : {}),
  ...(getArg('--dedupe-key') ? { dedupe_key: getArg('--dedupe-key') } : {}),
  ...(getArg('--created-from') ? { created_from: getArg('--created-from') } : {}),
  ...(getArg('--created-to') ? { created_to: getArg('--created-to') } : {}),
  limit: parseInteger(getArg('--limit') ?? process.env.OUTBOX_DEAD_LETTER_LIMIT, 100)
};

const replayReason = getArg('--reason') ?? 'operator_manual_requeue';
const requestedBy = getArg('--requested-by') ?? process.env.USER ?? 'operator';
const correlationId = getArg('--correlation-id');
const replayRunId = randomUUID();

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

const service = createPostgresDeadLetterReplayService({ db });

try {
  if (action === 'list') {
    const rows = await service.listDeadLetterJobs(filters);
    logEvent('outbox.dead_letter.list_completed', {
      replay_run_id: replayRunId,
      filter: filters,
      count: rows.length,
      jobs: rows
    });
  } else {
    const result = await service.requeueDeadLetterJobs({
      replay_run_id: replayRunId,
      replay_reason: replayReason,
      requested_by: requestedBy,
      ...(correlationId ? { correlation_id: correlationId } : {}),
      filters
    });
    logEvent('outbox.dead_letter.requeue_completed', {
      ...result
    });
  }
} catch (error) {
  logEvent('outbox.dead_letter.operation_failed', {
    replay_run_id: replayRunId,
    action,
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
