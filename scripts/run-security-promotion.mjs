#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { createPermanentBlockPromotionService } from '@forge/security-governance';
import { createPostgresPermanentBlockPromotionStore } from '@forge/security-governance/postgres-adapters';

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
    message.includes('uuid')
  ) {
    return 'invalid_request';
  }

  return 'unknown';
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

const packageId = (getArg('--package-id') ?? '').trim();
if (!isUuid(packageId)) {
  console.error('--package-id is required and must be a UUID.');
  process.exit(1);
}

const reviewerId = (getArg('--reviewer-id') ?? '').trim();
if (!reviewerId) {
  console.error('--reviewer-id is required.');
  process.exit(1);
}

const evidenceRef = (getArg('--evidence-ref') ?? '').trim();
if (!evidenceRef) {
  console.error('--evidence-ref is required (ticket/change request/document id).');
  process.exit(1);
}

const evidenceSummary = (getArg('--evidence-summary') ?? '').trim();
const reasonCode = (getArg('--reason-code') ?? 'policy_blocked_malware').trim();
const reviewerConfirmedAt = parseIso(getArg('--reviewer-confirmed-at')) ?? new Date().toISOString();
const createdAt = parseIso(getArg('--created-at')) ?? reviewerConfirmedAt;
const windowInterval = (getArg('--window-interval') ?? '30 days').trim();
const runId = getArg('--run-id') ?? randomUUID();

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

const store = createPostgresPermanentBlockPromotionStore({ db });
const service = createPermanentBlockPromotionService({ store });

try {
  logEvent('security_promotion.run_started', {
    run_id: runId,
    mode,
    package_id: packageId,
    reviewer_id: reviewerId,
    reviewer_confirmed_at: reviewerConfirmedAt,
    reason_code: reasonCode,
    window_interval: windowInterval,
    evidence_ref: evidenceRef,
    has_evidence_summary: evidenceSummary.length > 0
  });

  if (mode === 'dry-run') {
    const validation = await store.validate({
      package_id: packageId,
      reviewer_id: reviewerId,
      reviewer_confirmed_at: reviewerConfirmedAt,
      window_interval: windowInterval
    });

    logEvent('security_promotion.dry_run_completed', {
      run_id: runId,
      mode,
      package_id: packageId,
      reviewer_id: reviewerId,
      evidence_ref: evidenceRef,
      evidence_summary: evidenceSummary || null,
      eligible: validation.eligible,
      validation
    });
  } else {
    const result = await service.promote({
      package_id: packageId,
      reason_code: reasonCode,
      reviewer_id: reviewerId,
      reviewer_confirmed_at: reviewerConfirmedAt,
      created_at: createdAt,
      window_interval: windowInterval
    });

    if (result.status === 'promoted' && result.action_id) {
      await db.query(
        `
          UPDATE security_enforcement_actions
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE action_id = $1
        `,
        [
          result.action_id,
          JSON.stringify({
            reviewer_evidence_ref: evidenceRef,
            reviewer_evidence_summary: evidenceSummary || null,
            promotion_run_id: runId,
            recorded_at: new Date().toISOString()
          })
        ]
      );
    }

    logEvent('security_promotion.production_completed', {
      run_id: runId,
      mode,
      package_id: packageId,
      reviewer_id: reviewerId,
      evidence_ref: evidenceRef,
      evidence_summary: evidenceSummary || null,
      result
    });
  }
} catch (error) {
  logEvent('security_promotion.run_failed', {
    run_id: runId,
    mode,
    package_id: packageId,
    reviewer_id: reviewerId,
    evidence_ref: evidenceRef,
    failure_class: classifyFailure(error),
    error_message: error instanceof Error ? error.message : 'unknown_error'
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
