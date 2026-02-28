#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { createSecurityTrustGateDecisionService } from '@forge/security-governance';
import {
  createPostgresSecurityPromotionDecisionStore,
  createPostgresSecurityRolloutStateStore,
  createPostgresSecurityTrustGateMetricsStore
} from '@forge/security-governance/postgres-adapters';

const VALID_MODES = new Set(['dry-run', 'production']);
const VALID_ACTIONS = new Set(['snapshot', 'evaluate']);

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

function parseNumber(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

  if (
    message.includes('required') ||
    message.includes('invalid') ||
    message.includes('must be') ||
    message.includes('parse')
  ) {
    return 'invalid_request';
  }

  return 'unknown';
}

const mode = (getArg('--mode') ?? 'dry-run').toLowerCase();
if (!VALID_MODES.has(mode)) {
  console.error(`Invalid --mode "${mode}". Expected dry-run or production.`);
  process.exit(1);
}

const action = (getArg('--action') ?? 'evaluate').toLowerCase();
if (!VALID_ACTIONS.has(action)) {
  console.error(`Invalid --action "${action}". Expected snapshot or evaluate.`);
  process.exit(1);
}

const databaseUrl = process.env.FORGE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FORGE_DATABASE_URL or DATABASE_URL is required.');
  process.exit(1);
}

const now = new Date();
const windowTo = parseIso(getArg('--window-to')) ?? now.toISOString();
const windowFrom =
  parseIso(getArg('--window-from')) ??
  new Date(now.valueOf() - 7 * 24 * 60 * 60 * 1000).toISOString();

if (new Date(windowFrom).valueOf() >= new Date(windowTo).valueOf()) {
  console.error('Invalid window: --window-from must be earlier than --window-to.');
  process.exit(1);
}

const historyLimit = parseInteger(getArg('--history-limit') ?? process.env.SECURITY_TRUST_GATE_HISTORY_LIMIT, 5);
if (historyLimit < 1 || historyLimit > 100) {
  console.error('Invalid --history-limit. Expected integer between 1 and 100.');
  process.exit(1);
}

const falsePositiveRateThreshold = parseNumber(
  getArg('--false-positive-rate-threshold') ?? process.env.SECURITY_TRUST_GATE_FALSE_POSITIVE_RATE_THRESHOLD,
  0.01
);
const appealsSlaThreshold = parseNumber(
  getArg('--appeals-sla-threshold') ?? process.env.SECURITY_TRUST_GATE_APPEALS_SLA_THRESHOLD,
  1
);
const requiredConsecutiveWindows = parseInteger(
  getArg('--required-consecutive-windows') ?? process.env.SECURITY_TRUST_GATE_REQUIRED_WINDOWS,
  2
);

if (requiredConsecutiveWindows < 1 || requiredConsecutiveWindows > 30) {
  console.error('Invalid --required-consecutive-windows. Expected integer between 1 and 30.');
  process.exit(1);
}

if (!Number.isFinite(falsePositiveRateThreshold) || falsePositiveRateThreshold < 0 || falsePositiveRateThreshold > 1) {
  console.error('Invalid --false-positive-rate-threshold. Expected number between 0 and 1.');
  process.exit(1);
}

if (!Number.isFinite(appealsSlaThreshold) || appealsSlaThreshold < 0 || appealsSlaThreshold > 1) {
  console.error('Invalid --appeals-sla-threshold. Expected number between 0 and 1.');
  process.exit(1);
}

const runId = getArg('--run-id') ?? randomUUID();
const trigger = getArg('--trigger') ?? 'script.run-security-trust-gates';

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

const metricsStore = createPostgresSecurityTrustGateMetricsStore({ db });
const rolloutStateStore = createPostgresSecurityRolloutStateStore({ db });
const decisionStore = createPostgresSecurityPromotionDecisionStore({ db });

try {
  logEvent('security_trust_gate.run_started', {
    run_id: runId,
    mode,
    action,
    window_from: windowFrom,
    window_to: windowTo,
    trigger,
    history_limit: historyLimit,
    false_positive_rate_threshold: falsePositiveRateThreshold,
    appeals_sla_threshold: appealsSlaThreshold,
    required_consecutive_windows: requiredConsecutiveWindows
  });

  const snapshot = await metricsStore.getSnapshot({
    window_from: windowFrom,
    window_to: windowTo,
    now_iso: new Date().toISOString()
  });

  const currentState = await rolloutStateStore.getState(new Date().toISOString());
  const recentDecisions = await decisionStore.listRecent(historyLimit);

  if (action === 'snapshot') {
    logEvent('security_trust_gate.snapshot_completed', {
      run_id: runId,
      mode,
      window_from: windowFrom,
      window_to: windowTo,
      snapshot,
      current_rollout_state: currentState,
      recent_decision_count: recentDecisions.length,
      recent_decisions: recentDecisions
    });
    process.exitCode = 0;
  } else {
    const evaluationService =
      mode === 'production'
        ? createSecurityTrustGateDecisionService({
            metricsStore,
            rolloutStateStore,
            decisionStore,
            falsePositiveRateThreshold,
            appealsSlaThreshold,
            requiredConsecutiveWindows
          })
        : createSecurityTrustGateDecisionService({
            metricsStore,
            rolloutStateStore: {
              async getState(nowIso) {
                return rolloutStateStore.getState(nowIso);
              },
              async updateState(input) {
                return {
                  current_mode: input.current_mode,
                  freeze_active: input.freeze_active,
                  freeze_reason: input.freeze_reason,
                  decision_run_id: input.decision_run_id,
                  decision_evidence: input.decision_evidence,
                  updated_at: input.updated_at
                };
              }
            },
            decisionStore: {
              async listRecent(limit) {
                return decisionStore.listRecent(limit);
              },
              async append() {
                return;
              }
            },
            falsePositiveRateThreshold,
            appealsSlaThreshold,
            requiredConsecutiveWindows
          });

    const result = await evaluationService.evaluate({
      run_id: runId,
      window_from: windowFrom,
      window_to: windowTo,
      trigger
    });

    logEvent('security_trust_gate.evaluate_completed', {
      run_id: runId,
      mode,
      persisted: mode === 'production',
      result,
      pre_eval_rollout_state: currentState,
      recent_decision_count: recentDecisions.length
    });
  }
} catch (error) {
  logEvent('security_trust_gate.run_failed', {
    run_id: runId,
    mode,
    action,
    window_from: windowFrom,
    window_to: windowTo,
    failure_class: classifyFailure(error),
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
