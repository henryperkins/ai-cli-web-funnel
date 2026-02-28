import { describe, expect, it } from 'vitest';
import {
  ADDON_METADATA_CONTRACT_VERSION,
  COMPATIBILITY_MATRIX_VERSION,
  INSTALL_LIFECYCLE_ENDPOINTS,
  INSTALL_PLAN_CONFLICT_CODES,
  INSTALL_LIFECYCLE_CONTRACT_VERSION,
  INSTALL_LIFECYCLE_EXECUTION_REASON_CODE,
  INSTALL_LIFECYCLE_HTTP_STATUS,
  INSTALL_LIFECYCLE_HTTP_ERROR_REASON,
  buildInstallLifecyclePlanPath,
  isInstallLifecycleDependencyResolutionFailureReason,
  isInstallLifecycleExecutionReasonCode,
  isInstallLifecycleHttpErrorReason,
  isInstallLifecycleReasonCode,
  isInstallTrustResetTrigger,
  isInstallTrustState
} from '../src/index.js';

describe('install lifecycle shared contracts', () => {
  it('exports frozen v1 contract version markers', () => {
    expect(ADDON_METADATA_CONTRACT_VERSION).toBe('v1.0.0');
    expect(INSTALL_LIFECYCLE_CONTRACT_VERSION).toBe('v1.0.0');
    expect(COMPATIBILITY_MATRIX_VERSION).toBe('v1.0.0');
  });

  it('exposes stable endpoint templates and plan path builder', () => {
    expect(INSTALL_LIFECYCLE_ENDPOINTS.createPlan).toBe('/v1/install/plans');
    expect(INSTALL_LIFECYCLE_ENDPOINTS.installPlanAlias).toBe('/v1/install/plans/:plan_id/install');
    expect(buildInstallLifecyclePlanPath('plan-1')).toBe('/v1/install/plans/plan-1');
    expect(buildInstallLifecyclePlanPath('plan-1', 'verify')).toBe('/v1/install/plans/plan-1/verify');
    expect(buildInstallLifecyclePlanPath('plan/with/slash', 'remove')).toBe(
      '/v1/install/plans/plan%2Fwith%2Fslash/remove'
    );
  });

  it('validates trust-state and trust-reset-trigger enums deterministically', () => {
    expect(isInstallTrustState('trusted')).toBe(true);
    expect(isInstallTrustState('invalid')).toBe(false);
    expect(isInstallTrustResetTrigger('none')).toBe(true);
    expect(isInstallTrustResetTrigger('invalid')).toBe(false);
  });

  it('recognizes canonical lifecycle HTTP error reasons including dependency failure prefixes', () => {
    expect(
      isInstallLifecycleHttpErrorReason(
        INSTALL_LIFECYCLE_HTTP_ERROR_REASON.idempotencyKeyPayloadConflict
      )
    ).toBe(true);
    expect(isInstallLifecycleHttpErrorReason('dependency_resolution_failed: cycle_detected')).toBe(
      false
    );
    expect(
      isInstallLifecycleDependencyResolutionFailureReason(
        'dependency_resolution_failed: cycle_detected'
      )
    ).toBe(true);
    expect(isInstallLifecycleExecutionReasonCode('adapter_write_failed')).toBe(true);
    expect(isInstallLifecycleExecutionReasonCode('adapter_disk_io_failed')).toBe(true);
    expect(isInstallLifecycleExecutionReasonCode('not_a_known_reason')).toBe(false);
    expect(isInstallLifecycleReasonCode(INSTALL_LIFECYCLE_HTTP_ERROR_REASON.planNotFound)).toBe(true);
    expect(
      isInstallLifecycleReasonCode(
        INSTALL_LIFECYCLE_EXECUTION_REASON_CODE.preflightChecksFailed
      )
    ).toBe(true);
    expect(isInstallLifecycleReasonCode('dependency_resolution_failed: cycle_detected')).toBe(true);
    expect(isInstallLifecycleHttpErrorReason('unknown_reason')).toBe(false);
  });

  it('includes dependency_resolution_failed in lifecycle status set', () => {
    expect(INSTALL_LIFECYCLE_HTTP_STATUS).toContain(
      INSTALL_LIFECYCLE_HTTP_ERROR_REASON.dependencyResolutionFailed
    );
  });

  it('exports normalized plan conflict taxonomy codes', () => {
    expect(INSTALL_PLAN_CONFLICT_CODES).toEqual([
      'dependency_cycle',
      'dependency_missing',
      'dependency_duplicate',
      'version_incompatible',
      'capability_incompatible',
      'runtime_incompatible',
      'policy_blocked'
    ]);
  });
});
