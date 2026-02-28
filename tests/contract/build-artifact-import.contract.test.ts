import { describe, expect, it } from 'vitest';

describe('contract: built artifact imports', () => {
  it('imports workspace packages through built ESM exports', async () => {
    const controlPlane = await import('@forge/control-plane');
    const runtimeDaemon = await import('@forge/runtime-daemon');
    const policyEngine = await import('@forge/policy-engine');
    const securityGovernance = await import('@forge/security-governance');
    const sharedContracts = await import('@forge/shared-contracts');

    expect(typeof controlPlane.createEventIngestionEntrypoint).toBe('function');
    expect(typeof runtimeDaemon.createRuntimeStartPipeline).toBe('function');
    expect(typeof policyEngine.evaluatePolicyPreflight).toBe('function');
    expect(typeof securityGovernance.createSignedReporterIngestionService).toBe('function');
    expect(typeof sharedContracts.validateTelemetryEventEnvelope).toBe('function');
  });
});
