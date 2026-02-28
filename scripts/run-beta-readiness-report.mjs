#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';

const VALID_MODES = new Set(['dry-run', 'production']);

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function parseIso(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed.toISOString();
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseInteger(value) {
  const parsed = parseNumber(value);
  return parsed === null ? 0 : Math.max(0, Math.trunc(parsed));
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
    message.includes('connection')
  ) {
    return 'transient';
  }

  if (message.includes('required') || message.includes('invalid') || message.includes('window')) {
    return 'invalid_request';
  }

  return 'unknown';
}

function evaluateKpi({
  key,
  direction,
  threshold,
  value,
  sampleSize,
  minSample,
  source,
  metadata = {}
}) {
  const hasValue = typeof value === 'number' && Number.isFinite(value);
  const hasSample = sampleSize >= minSample;

  if (!hasValue) {
    return {
      key,
      source,
      direction,
      threshold,
      value: null,
      sample_size: sampleSize,
      min_sample_size: minSample,
      status: 'insufficient_data',
      pass: false,
      metadata
    };
  }

  if (!hasSample) {
    return {
      key,
      source,
      direction,
      threshold,
      value,
      sample_size: sampleSize,
      min_sample_size: minSample,
      status: 'insufficient_data',
      pass: false,
      metadata
    };
  }

  const pass = direction === 'at_least' ? value >= threshold : value <= threshold;

  return {
    key,
    source,
    direction,
    threshold,
    value,
    sample_size: sampleSize,
    min_sample_size: minSample,
    status: pass ? 'pass' : 'fail',
    pass,
    metadata
  };
}

const mode = (getArg('--mode') ?? 'dry-run').toLowerCase();
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
const to = parseIso(getArg('--to')) ?? now.toISOString();
const from =
  parseIso(getArg('--from')) ??
  new Date(now.valueOf() - 7 * 24 * 60 * 60 * 1000).toISOString();

if (new Date(from).valueOf() >= new Date(to).valueOf()) {
  console.error('Invalid window: --from must be earlier than --to.');
  process.exit(1);
}

const outputPath = getArg('--output') ?? 'artifacts/beta-readiness-report.json';

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
  }
};

try {
  logEvent('beta_readiness.run_started', {
    mode,
    window_from: from,
    window_to: to,
    output_path: mode === 'production' ? outputPath : null
  });

  const snapshotsResult = await db.query(
    `
      SELECT DISTINCT ON (metric_key)
        metric_key,
        ratio,
        numerator,
        denominator,
        sample_size,
        metadata,
        window_from,
        window_to,
        created_at
      FROM operational_slo_snapshots
      WHERE window_from >= $1::timestamptz
        AND window_to <= $2::timestamptz
      ORDER BY metric_key, window_to DESC, created_at DESC
    `,
    [from, to]
  );

  const snapshotsByKey = new Map(
    snapshotsResult.rows.map((row) => [
      String(row.metric_key),
      {
        ratio: parseNumber(row.ratio),
        numerator: parseInteger(row.numerator),
        denominator: parseInteger(row.denominator),
        sample_size: parseInteger(row.sample_size),
        metadata: parseJsonObject(row.metadata),
        window_from: row.window_from,
        window_to: row.window_to,
        created_at: row.created_at
      }
    ])
  );

  const lifecycleCountsResult = await db.query(
    `
      SELECT
        (SELECT COUNT(*)::text FROM install_plans WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS install_plan_count,
        (SELECT COUNT(*)::text FROM install_apply_attempts WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz) AS install_apply_attempt_count,
        (SELECT COUNT(*)::text FROM install_verify_attempts WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz) AS install_verify_attempt_count,
        (SELECT COUNT(*)::text FROM profile_install_runs WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz) AS profile_install_run_count,
        (SELECT COUNT(*)::text FROM security_enforcement_promotion_decisions WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS trust_gate_decision_count,
        (SELECT COUNT(*)::text FROM security_enforcement_actions WHERE state = 'policy_blocked_perm' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS permanent_block_action_count
    `,
    [from, to]
  );

  const countsRow = lifecycleCountsResult.rows[0] ?? {};

  const installApply = snapshotsByKey.get('install.apply.success_rate');
  const installVerify = snapshotsByKey.get('install.verify.success_rate');
  const profileInstall = snapshotsByKey.get('profile.install_run.success_rate');
  const semanticFallback = snapshotsByKey.get('retrieval.semantic_fallback.rate');
  const deadLetterRate = snapshotsByKey.get('outbox.dispatch.dead_letter_rate');
  const coldStart = snapshotsByKey.get('funnel.cold_start.success_rate');
  const retryless = snapshotsByKey.get('funnel.retryless.success_rate');
  const ttfsc = snapshotsByKey.get('funnel.ttfsc.p90_seconds');

  const ttfscExact = parseNumber(ttfsc?.metadata?.p90_seconds_exact ?? null);
  const ttfscValue = ttfscExact ?? parseNumber(ttfsc?.numerator ?? null);

  const kpis = [
    evaluateKpi({
      key: 'install.apply.success_rate',
      source: 'operational_slo_snapshots',
      direction: 'at_least',
      threshold: 0.98,
      value: installApply?.ratio ?? null,
      sampleSize: installApply?.sample_size ?? 0,
      minSample: 20,
      metadata: installApply?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'install.verify.success_rate',
      source: 'operational_slo_snapshots',
      direction: 'at_least',
      threshold: 0.97,
      value: installVerify?.ratio ?? null,
      sampleSize: installVerify?.sample_size ?? 0,
      minSample: 20,
      metadata: installVerify?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'profile.install_run.success_rate',
      source: 'operational_slo_snapshots',
      direction: 'at_least',
      threshold: 0.95,
      value: profileInstall?.ratio ?? null,
      sampleSize: profileInstall?.sample_size ?? 0,
      minSample: 10,
      metadata: profileInstall?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'retrieval.semantic_fallback.rate',
      source: 'operational_slo_snapshots',
      direction: 'at_most',
      threshold: 0.15,
      value: semanticFallback?.ratio ?? null,
      sampleSize: semanticFallback?.sample_size ?? 0,
      minSample: 20,
      metadata: semanticFallback?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'outbox.dispatch.dead_letter_rate',
      source: 'operational_slo_snapshots',
      direction: 'at_most',
      threshold: 0.01,
      value: deadLetterRate?.ratio ?? null,
      sampleSize: deadLetterRate?.sample_size ?? 0,
      minSample: 20,
      metadata: deadLetterRate?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'funnel.ttfsc.p90_seconds',
      source: 'operational_slo_snapshots',
      direction: 'at_most',
      threshold: 300,
      value: ttfscValue,
      sampleSize: ttfsc?.sample_size ?? 0,
      minSample: 10,
      metadata: ttfsc?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'funnel.cold_start.success_rate',
      source: 'operational_slo_snapshots',
      direction: 'at_least',
      threshold: 0.95,
      value: coldStart?.ratio ?? null,
      sampleSize: coldStart?.sample_size ?? 0,
      minSample: 20,
      metadata: coldStart?.metadata ?? {}
    }),
    evaluateKpi({
      key: 'funnel.retryless.success_rate',
      source: 'operational_slo_snapshots',
      direction: 'at_least',
      threshold: 0.85,
      value: retryless?.ratio ?? null,
      sampleSize: retryless?.sample_size ?? 0,
      minSample: 20,
      metadata: retryless?.metadata ?? {}
    })
  ];

  const passCount = kpis.filter((kpi) => kpi.status === 'pass').length;
  const failCount = kpis.filter((kpi) => kpi.status === 'fail').length;
  const insufficientDataCount = kpis.filter((kpi) => kpi.status === 'insufficient_data').length;

  const goNoGo =
    failCount > 0 ? 'no-go' : insufficientDataCount > 0 ? 'blocked' : 'go';

  const report = {
    generated_at: new Date().toISOString(),
    mode,
    window_from: from,
    window_to: to,
    go_no_go: goNoGo,
    summary: {
      kpi_total: kpis.length,
      pass_count: passCount,
      fail_count: failCount,
      insufficient_data_count: insufficientDataCount
    },
    lifecycle_counts: {
      install_plan_count: parseInteger(countsRow.install_plan_count),
      install_apply_attempt_count: parseInteger(countsRow.install_apply_attempt_count),
      install_verify_attempt_count: parseInteger(countsRow.install_verify_attempt_count),
      profile_install_run_count: parseInteger(countsRow.profile_install_run_count),
      trust_gate_decision_count: parseInteger(countsRow.trust_gate_decision_count),
      permanent_block_action_count: parseInteger(countsRow.permanent_block_action_count)
    },
    kpis
  };

  if (mode === 'production') {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  logEvent('beta_readiness.run_completed', {
    ...report,
    output_path: mode === 'production' ? outputPath : null
  });
} catch (error) {
  logEvent('beta_readiness.run_failed', {
    mode,
    window_from: from,
    window_to: to,
    failure_class: classifyFailure(error),
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
