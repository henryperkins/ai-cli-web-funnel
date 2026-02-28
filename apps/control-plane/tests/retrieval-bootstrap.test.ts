import { describe, expect, it } from 'vitest';
import { startControlPlaneRetrievalSearchService } from '../src/retrieval-bootstrap.js';
import {
  resolveRetrievalSearchServiceForStartup,
  type ControlPlaneStartupLogger
} from '../src/server.js';

class FakeDb {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    this.calls.push({ sql, params });

    return {
      rows: [
        {
          package_id: '11111111-1111-4111-8111-111111111111',
          document_text: 'acme package one',
          rank_score: 2
        }
      ] as Row[],
      rowCount: 1
    };
  }
}

function buildLogger() {
  const events: Array<{ event_name: string; payload: Record<string, unknown> }> = [];
  const startupLogger: ControlPlaneStartupLogger = {
    log(event) {
      events.push({
        event_name: event.event_name,
        payload: event.payload
      });
    }
  };

  return {
    events,
    startupLogger
  };
}

describe('control-plane retrieval bootstrap wiring', () => {
  it('fails fast when embedding key env is missing', async () => {
    await expect(
      startControlPlaneRetrievalSearchService({
        env: {
          QDRANT_URL: 'https://qdrant.example.test',
          QDRANT_API_KEY: 'qdrant-key',
          QDRANT_COLLECTION: 'forge-packages',
          EMBEDDING_MODEL: 'text-embedding-3-small',
          EMBEDDING_DIMENSIONS: '3'
        },
        db: new FakeDb()
      })
    ).rejects.toThrow('EMBEDDING_API_KEY or OPENAI_API_KEY is required');
  });

  it('boots retrieval service from env and keeps deterministic semantic fallback behavior', async () => {
    const db = new FakeDb();

    const service = await startControlPlaneRetrievalSearchService({
      env: {
        QDRANT_URL: 'https://qdrant.example.test',
        QDRANT_API_KEY: 'qdrant-key',
        QDRANT_COLLECTION: 'forge-packages',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        EMBEDDING_DIMENSIONS: '3',
        OPENAI_API_KEY: 'openai-key'
      },
      db,
      embeddingFetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                embedding: [0.1, 0.2, 0.3]
              }
            ]
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        ),
      qdrantFetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/collections/forge-packages')) {
          return new Response(
            JSON.stringify({
              result: {
                config: {
                  params: {
                    vectors: {
                      size: 3
                    }
                  }
                }
              }
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json'
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            result: [
              {
                id: 'qdrant-1',
                score: 0.9,
                payload: {
                  package_id: '11111111-1111-4111-8111-111111111111',
                  text: 'semantic package one'
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }
    });

    const result = await service.search('acme', 5);

    expect(result.semantic_fallback).toBe(false);
    expect(result.documents[0]?.metadata?.package_id).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(db.calls).toHaveLength(1);
  });

  it('marks startup not_ready when required retrieval bootstrap fails', async () => {
    const { startupLogger, events } = buildLogger();
    const readinessState = {
      ok: true,
      details: [] as string[]
    };

    const service = await resolveRetrievalSearchServiceForStartup({
      config: {
        host: '127.0.0.1',
        port: 8787,
        databaseUrl: 'postgres://example.invalid/forge',
        requireRetrievalBootstrap: true
      },
      env: {},
      db: new FakeDb(),
      startupLogger,
      readinessState,
      retrievalBootstrap: async () => {
        throw new Error('bootstrap_failed_for_test');
      }
    });

    expect(service).toBeUndefined();
    expect(readinessState.ok).toBe(false);
    expect(readinessState.details).toEqual([
      'retrieval_bootstrap_failed:bootstrap_failed_for_test'
    ]);
    expect(events[0]).toEqual({
      event_name: 'control_plane.startup.retrieval_bootstrap_failed',
      payload: {
        reason: 'bootstrap_failed_for_test'
      }
    });
  });

  it('keeps startup ready when retrieval bootstrap succeeds', async () => {
    const { startupLogger, events } = buildLogger();
    const readinessState = {
      ok: true,
      details: [] as string[]
    };

    const service = await resolveRetrievalSearchServiceForStartup({
      config: {
        host: '127.0.0.1',
        port: 8787,
        databaseUrl: 'postgres://example.invalid/forge',
        requireRetrievalBootstrap: true
      },
      env: {},
      db: new FakeDb(),
      startupLogger,
      readinessState,
      retrievalBootstrap: async () => ({
        config: {
          embeddingModel: 'text-embedding-3-small',
          qdrantCollection: 'forge-packages'
        },
        async search() {
          return {
            documents: [],
            semantic_fallback: false
          };
        }
      })
    });

    expect(service).toBeDefined();
    expect(readinessState.ok).toBe(true);
    expect(readinessState.details).toEqual([]);
    expect(events[0]).toEqual({
      event_name: 'control_plane.startup.retrieval_bootstrap_ready',
      payload: {
        qdrant_collection: 'forge-packages',
        embedding_model: 'text-embedding-3-small'
      }
    });
  });

  it('skips retrieval bootstrap when not required', async () => {
    const { startupLogger } = buildLogger();
    const readinessState = {
      ok: true,
      details: [] as string[]
    };

    const service = await resolveRetrievalSearchServiceForStartup({
      config: {
        host: '127.0.0.1',
        port: 8787,
        databaseUrl: 'postgres://example.invalid/forge',
        requireRetrievalBootstrap: false
      },
      env: {},
      db: new FakeDb(),
      startupLogger,
      readinessState,
      retrievalBootstrap: async () => {
        throw new Error('must_not_run');
      }
    });

    expect(service).toBeUndefined();
    expect(readinessState.ok).toBe(true);
    expect(readinessState.details).toEqual([]);
  });
});
