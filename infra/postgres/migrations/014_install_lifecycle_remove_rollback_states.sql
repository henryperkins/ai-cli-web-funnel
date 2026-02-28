-- Wave 10 install lifecycle remove/rollback state extension.
-- LOCK RISK:
--   - ALTER TABLE ... DROP/ADD CONSTRAINT takes ACCESS EXCLUSIVE locks on touched tables.
--   - Operations are metadata-only but briefly block concurrent writes to install lifecycle tables.
-- Rollback playbook:
--   - Prefer forward compensation migration.
--   - If emergency rollback is required, stop lifecycle writers, archive rows using new statuses/stages,
--     then apply a compensating migration that restores the prior check constraints.

ALTER TABLE install_plans
  DROP CONSTRAINT IF EXISTS install_plans_status_check;

ALTER TABLE install_plans
  ADD CONSTRAINT install_plans_status_check
  CHECK (
    status IN (
      'planned',
      'apply_succeeded',
      'apply_failed',
      'verify_succeeded',
      'verify_failed',
      'remove_succeeded',
      'remove_failed',
      'rollback_succeeded',
      'rollback_failed'
    )
  );

ALTER TABLE install_plan_audit
  DROP CONSTRAINT IF EXISTS install_plan_audit_stage_check;

ALTER TABLE install_plan_audit
  ADD CONSTRAINT install_plan_audit_stage_check
  CHECK (stage IN ('plan', 'apply', 'verify', 'remove', 'rollback'));