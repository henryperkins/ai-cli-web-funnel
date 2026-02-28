import { startForgeControlPlaneServerFromEnv } from './server.js';
import { startControlPlaneRetrievalSearchService } from './retrieval-bootstrap.js';

async function main(): Promise<void> {
  const server = await startForgeControlPlaneServerFromEnv({
    retrievalBootstrap: async ({ env, db, startupLogger }) =>
      startControlPlaneRetrievalSearchService({
        env,
        db,
        logger: {
          log(event) {
            return startupLogger.log(event);
          }
        }
      })
  });

  console.log(
    JSON.stringify({
      event_name: 'control_plane.started',
      occurred_at: new Date().toISOString(),
      payload: {
        host: server.host,
        port: server.port
      }
    })
  );

  const close = async (signal: 'SIGINT' | 'SIGTERM') => {
    await server.close();
    console.log(
      JSON.stringify({
        event_name: 'control_plane.stopped',
        occurred_at: new Date().toISOString(),
        payload: {
          signal
        }
      })
    );
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', () => {
    void close('SIGINT');
  });
  process.on('SIGTERM', () => {
    void close('SIGTERM');
  });
}

void main();
