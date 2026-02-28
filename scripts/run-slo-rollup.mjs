#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { createOperationalSloRollupService } from '@forge/security-governance';

const VALID_MODES = new Set(['dry-run', 'production']);

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

function parseIsoOrNull(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  return date.toISOString();
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

function classifyFailure(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('timeout') ||
    message.includes('tempor') ||
    message.includes('transient') ||
    message.includes('rate')
  ) {
    return 'transient';
  }

  if (message.includes('invalid') || message.includes('required') || message.includes('parse')) {
    return 'invalid_request';
  }

  return 'unknown';
}

const mode = getArg('--mode') ?? process.env.SLO_ROLLUP_MODE ?? 'dry-run';
if (!VALID_MODES.has(mode)) {
  console.error(`Invalid --mode "${mode}". Expected dry-run or production.`);
  process.exit(1);
}

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required.');
  process.exit(1);
}

const now = new Date();
const defaultTo = now.toISOString();
const defaultFrom = new Date(now.valueOf() - 60 * 60 * 1000).toISOString();

const windowFrom = parseIsoOrNull(getArg('--from')) ?? defaultFrom;
const windowTo = parseIsoOrNull(getArg('--to')) ?? defaultTo;
const limit = parseInteger(getArg('--limit') ?? process.env.SLO_ROLLUP_LIMIT, 100);

if (new Date(windowFrom).valueOf() >= new Date(windowTo).valueOf()) {
  console.error('Invalid window: --from must be earlier than --to.');
  process.exit(1);
}

if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
  console.error('Invalid --limit. Expected integer between 1 and 10000.');
  process.exit(1);
}

const runId = randomUUID();
const pool = new Pool({ connectionString: databaseUrl });

const db = {
  async query(sql, params = []) {
    const result = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  }
};

const service = createOperationalSloRollupService({ db });

try {
  logEvent('slo_rollup.run_started', {
    run_id: runId,
    mode,
    window_from: windowFrom,
    window_to: windowTo,
    limit
  });

  const result = await service.run({
    run_id: runId,
    mode,
    window_from: windowFrom,
    window_to: windowTo,
    trigger: 'script.run-slo-rollup',
    limit
  });

  logEvent('slo_rollup.run_completed', {
    run_id: result.run_id,
    mode: result.mode,
    window_from: result.window_from,
    window_to: result.window_to,
    metric_count: result.metrics.length,
    persisted: result.persisted,
    metrics: result.metrics
  });
} catch (error) {
  logEvent('slo_rollup.run_failed', {
    run_id: runId,
    mode,
    window_from: windowFrom,
    window_to: windowTo,
    failure_class: classifyFailure(error),
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}

