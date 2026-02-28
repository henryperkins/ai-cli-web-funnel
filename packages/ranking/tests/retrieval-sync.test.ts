import { describe, expect, it } from 'vitest';
import {
  classifyRetrievalSyncFailure,
  createRetrievalSyncService,
  projectRetrievalSyncDocument,
  type RetrievalSyncDocument
} from '../src/retrieval-sync.js';

describe('retrieval sync service', () => {
  it('projects deterministic document text and fingerprint for equivalent candidate shapes', () => {
    const first = projectRetrievalSyncDocument({
      package_id: '11111111-1111-4111-8111-111111111111',
      package_slug: 'acme/pkg',
      canonical_repo: 'github.com/acme/pkg',
      updated_at: '2026-03-01T00:00:00Z',
      aliases: ['@acme/pkg', ' pkg-alt ', '@acme/pkg'],
      title: 'Acme Package',
      description: 'Deterministic projection.'
    });

    const second = projectRetrievalSyncDocument({
      package_id: '11111111-1111-4111-8111-111111111111',
      package_slug: 'acme/pkg',
      canonical_repo: 'github.com/acme/pkg',
      updated_at: '2026-03-01T00:00:00Z',
      aliases: ['pkg-alt', '@acme/pkg'],
      title: 'Acme Package',
      description: 'Deterministic projection.'
    });

    expect(first.text).toBe(second.text);
    expect(first.metadata.aliases).toEqual(['@acme/pkg', 'pkg-alt']);
    expect(first.payload_sha256).toBe(second.payload_sha256);
  });

  it('skips unchanged documents and only upserts changed projections in apply mode', async () => {
    const upsertedDocs: RetrievalSyncDocument[] = [];
    const persistedDocs: RetrievalSyncDocument[] = [];

    const service = createRetrievalSyncService({
      candidateStore: {
        async listBatch() {
          return {
            candidates: [
              {
                package_id: '11111111-1111-4111-8111-111111111111',
                package_slug: 'acme/one',
                canonical_repo: 'github.com/acme/one',
                updated_at: '2026-03-01T00:00:00Z',
                aliases: ['@acme/one'],
                title: 'One',
                description: 'unchanged'
              },
              {
                package_id: '22222222-2222-4222-8222-222222222222',
                package_slug: 'acme/two',
                canonical_repo: 'github.com/acme/two',
                updated_at: '2026-03-01T00:00:00Z',
                aliases: ['@acme/two'],
                title: 'Two',
                description: 'changed'
              }
            ],
            next_cursor: null
          };
        }
      },
      stateStore: {
        async getHashes() {
          const unchanged = projectRetrievalSyncDocument({
            package_id: '11111111-1111-4111-8111-111111111111',
            package_slug: 'acme/one',
            canonical_repo: 'github.com/acme/one',
            updated_at: '2026-03-01T00:00:00Z',
            aliases: ['@acme/one'],
            title: 'One',
            description: 'unchanged'
          });
          return new Map<string, string>([
            ['11111111-1111-4111-8111-111111111111', unchanged.payload_sha256]
          ]);
        },
        async upsertState(documents) {
          persistedDocs.push(...documents);
        }
      },
      semanticIndexWriter: {
        async upsertDocuments(documents) {
          upsertedDocs.push(...documents);
        }
      },
      now: () => new Date('2026-03-01T12:00:00Z')
    });

    const result = await service.run({
      mode: 'apply',
      run_id: 'run-1',
      limit: 50,
      cursor: null,
      trigger: 'unit_test'
    });

    expect(result).toMatchObject({
      candidate_count: 2,
      projected_count: 2,
      unchanged_count: 1,
      upserted_count: 1,
      persisted_state_count: 1
    });
    expect(upsertedDocs).toHaveLength(1);
    expect(upsertedDocs[0]?.metadata.package_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(persistedDocs).toHaveLength(1);
  });

  it('classifies transient vs permanent retrieval sync failures deterministically', () => {
    expect(classifyRetrievalSyncFailure(new Error('timeout while contacting qdrant'))).toBe(
      'transient'
    );
    expect(classifyRetrievalSyncFailure(new Error('retrieval_sync_config_invalid: QDRANT_URL is required'))).toBe(
      'permanent'
    );
  });
});
