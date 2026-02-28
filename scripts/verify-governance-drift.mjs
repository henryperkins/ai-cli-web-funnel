#!/usr/bin/env node
// Governance drift checker: detects silent AQ/MQ/DR status changes
// without corresponding DECISION_LOG.md updates.
//
// Usage: node scripts/verify-governance-drift.mjs
// Exit code 0: no drift detected
// Exit code 1: drift detected or error

import { readFileSync } from 'node:fs';
import process from 'node:process';

const GOVERNANCE_FILES = [
  'application_decision_records.md',
  'application_master_open_questions.md',
  'master_open_questions.md',
  'OPEN_QUESTIONS_TRACKER.md'
];

const DECISION_LOG = 'DECISION_LOG.md';

// Read DECISION_LOG to extract referenced AQ/MQ/DR IDs
function extractReferencedIds(content) {
  const matches = content.match(/(?:AQ|MQ|DR)-\d+/g);
  return new Set(matches ?? []);
}

// Extract status assignments from governance files
function extractStatusAssignments(content) {
  const results = [];
  const lines = content.split('\n');
  for (const line of lines) {
    // Look for patterns like "Status: Approved" or "**Status**: Approved"
    const statusMatch = line.match(/[Ss]tatus[:\s*]*\*?\*?\s*(Proposed|Open|Approved|Closed|Rejected|Deferred)/i);
    if (statusMatch) {
      const idMatch = line.match(/((?:AQ|MQ|DR)-\d+)/) ?? 
        lines[Math.max(0, lines.indexOf(line) - 5)]?.match(/((?:AQ|MQ|DR)-\d+)/);
      if (idMatch) {
        results.push({ id: idMatch[1], status: statusMatch[1] });
      }
    }
  }
  return results;
}

let driftDetected = false;

try {
  const decisionLog = readFileSync(DECISION_LOG, 'utf8');
  const referencedIds = extractReferencedIds(decisionLog);

  console.log(`DECISION_LOG.md references ${referencedIds.size} governance IDs.`);

  for (const file of GOVERNANCE_FILES) {
    try {
      const content = readFileSync(file, 'utf8');
      const assignments = extractStatusAssignments(content);
      
      const approvedWithoutLog = assignments.filter(
        (a) => a.status.toLowerCase() === 'approved' && !referencedIds.has(a.id)
      );
      
      if (approvedWithoutLog.length > 0) {
        driftDetected = true;
        console.error(`DRIFT in ${file}:`);
        for (const item of approvedWithoutLog) {
          console.error(`  ${item.id} is Approved but not referenced in DECISION_LOG.md`);
        }
      }
    } catch {
      // File may not exist, skip
    }
  }

  if (driftDetected) {
    console.error('\nGovernance drift detected. Update DECISION_LOG.md before proceeding.');
    process.exit(1);
  } else {
    console.log('No governance drift detected.');
  }
} catch (error) {
  console.error('Error reading governance files:', error.message);
  process.exit(1);
}
