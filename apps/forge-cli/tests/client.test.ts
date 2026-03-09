import { describe, expect, it, vi } from 'vitest';
import { createForgeClient } from '../src/client.js';

function mockFetch(response: { status: number; ok: boolean; body: unknown }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  })) as unknown as typeof fetch;
}

describe('createForgeClient', () => {
  it('search calls POST /v1/packages/search with correct body', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { query: 'test', semantic_fallback: false, results: [] },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    const res = await client.search('test', 5);

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data.query).toBe('test');

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/v1/packages/search');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ query: 'test', limit: 5 });
  });

  it('resolvePackageSlug calls GET with encoded slug query parameter', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: {
        package_id: 'pkg-1',
        package_slug: 'acme/forge-addon',
        canonical_repo: 'github.com/acme/forge-addon',
        updated_at: '2026-03-09T00:00:00Z',
      },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.resolvePackageSlug('acme/forge-addon');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/v1/packages/resolve?slug=acme%2Fforge-addon');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('getPackage calls GET with correct URL encoding', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: {
        package_id: 'abc-123',
        package_slug: null,
        canonical_repo: null,
        updated_at: '',
        aliases: [],
        lineage_summary: [],
        declared_permissions: null,
        freshness: null,
      },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.getPackage('abc/123');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/v1/packages/abc%2F123');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('createPlan sends correct payload', async () => {
    const fetchImpl = mockFetch({
      status: 201,
      ok: true,
      body: {
        status: 'planned',
        plan_id: 'p-1',
        package_id: 'pkg-1',
        package_slug: 'test',
        policy_outcome: 'allow',
        replayed: false,
      },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    const input = {
      package_id: 'pkg-1',
      org_id: 'org-1',
      requested_permissions: ['read'],
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [] as string[],
        block_flagged: false,
        permission_caps: { maxPermissions: 10, disallowedPermissions: [] as string[] },
      },
    } as const;

    const res = await client.createPlan(input);

    expect(res.ok).toBe(true);
    expect(res.data.plan_id).toBe('p-1');

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.package_id).toBe('pkg-1');
    expect(body.org_id).toBe('org-1');
    expect(body.requested_permissions).toEqual(['read']);
  });

  it('applyPlan calls correct URL', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: {
        status: 'applied',
        plan_id: 'p-1',
        replayed: false,
        attempt_number: 1,
        reason_code: null,
      },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.applyPlan('p-1');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/v1/install/plans/p-1/apply');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('error responses return ok: false with status code', async () => {
    const fetchImpl = mockFetch({
      status: 404,
      ok: false,
      body: { message: 'not found' },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    const res = await client.getPackage('nonexistent');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('listProfiles builds query string from options', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { profiles: [] },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.listProfiles({ limit: 10, offset: 5, visibility: 'public' });

    const [url] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('limit')).toBe('10');
    expect(parsed.searchParams.get('offset')).toBe('5');
    expect(parsed.searchParams.get('visibility')).toBe('public');
  });

  it('normalizes trailing slashes in the base URL', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { status: 'ok' },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787/', fetchImpl });

    await client.health();

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/health');
  });

  it('preserves a path prefix in the base URL', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { status: 'ok' },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787/control-plane/', fetchImpl });

    await client.health();

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/control-plane/health');
  });

  it('installProfile sends org policy payload', async () => {
    const fetchImpl = mockFetch({
      status: 201,
      ok: true,
      body: {
        run: {
          run_id: 'run-1',
          profile_id: 'profile-1',
          status: 'succeeded',
          total_packages: 1,
          succeeded_count: 1,
          failed_count: 0,
          skipped_count: 0,
          correlation_id: null,
          started_at: '2026-03-09T00:00:00Z',
          completed_at: '2026-03-09T00:00:01Z',
          plans: [],
        },
        plan_results: [],
      },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.installProfile('profile-1', {
      org_id: 'org-1',
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 10,
          disallowedPermissions: [],
        },
      },
      mode: 'apply_verify',
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/v1/profiles/profile-1/install');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      org_id: 'org-1',
      org_policy: {
        mcp_enabled: true,
        server_allowlist: [],
        block_flagged: false,
        permission_caps: {
          maxPermissions: 10,
          disallowedPermissions: [],
        },
      },
      mode: 'apply_verify',
    });
  });

  it('health calls GET /health', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { status: 'ok' },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    const res = await client.health();

    expect(res.ok).toBe(true);
    expect(res.data.status).toBe('ok');

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/health');
  });

  it('verifyPlan calls correct URL', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: {
        status: 'verified',
        plan_id: 'p-2',
        replayed: false,
        attempt_number: 1,
        reason_code: null,
        readiness: true,
        stages: [],
      },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.verifyPlan('p-2');

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/v1/install/plans/p-2/verify');
  });

  it('updatePlan sends target_version when provided', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { status: 'updated', plan_id: 'p-3', replayed: false, attempt_number: 1, reason_code: null },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.updatePlan('p-3', '2.0.0');

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.target_version).toBe('2.0.0');
  });

  it('updatePlan sends empty body when no version', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      ok: true,
      body: { status: 'updated', plan_id: 'p-3', replayed: false, attempt_number: 1, reason_code: null },
    });
    const client = createForgeClient({ baseUrl: 'http://localhost:8787', fetchImpl });

    await client.updatePlan('p-3');

    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({});
  });
});
