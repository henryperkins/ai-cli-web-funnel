#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result;
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}: ${stderr}`
    );
  }
  return String(result.stdout ?? '').trim();
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  run('docker', ['version'], { stdio: 'ignore' });

  const port = await findFreePort();
  const containerId = runCapture('docker', [
    'run',
    '--rm',
    '-d',
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_DB=forge_test',
    '-p',
    `${port}:5432`,
    'postgres:16-alpine'
  ]);

  const cleanup = () => {
    try {
      runCapture('docker', ['stop', containerId], { stdio: 'pipe' });
    } catch {
      // Best-effort cleanup.
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    let ready = false;
    const readyDeadline = Date.now() + 90_000;
    while (Date.now() < readyDeadline) {
      const probe = spawnSync(
        'docker',
        [
          'exec',
          containerId,
          'psql',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'postgres',
          '-d',
          'forge_test',
          '-c',
          'SELECT 1'
        ],
        { stdio: 'pipe' }
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    if (!ready) {
      throw new Error('Timed out waiting for postgres container readiness');
    }

    const migrationsDir = join(process.cwd(), 'infra', 'postgres', 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const migrationFile of migrationFiles) {
      const migrationPath = join(migrationsDir, migrationFile);
      run('bash', [
        '-lc',
        `cat "${migrationPath}" | docker exec -i "${containerId}" psql -v ON_ERROR_STOP=1 -U postgres -d forge_test`
      ]);
    }

    const integrationDbUrl = `postgres://postgres:postgres@127.0.0.1:${port}/forge_test`;
    run(
      'npm',
      ['run', 'test:integration-db'],
      {
        env: {
          ...process.env,
          FORGE_INTEGRATION_DB_URL: integrationDbUrl
        }
      }
    );
  } finally {
    cleanup();
  }
}

await main();
