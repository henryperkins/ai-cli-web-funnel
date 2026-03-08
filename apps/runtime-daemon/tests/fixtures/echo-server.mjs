import { createInterface } from 'node:readline';

const rl = createInterface({
  input: process.stdin
});

rl.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: {
              name: 'echo',
              version: '0.1.0'
            }
          }
        }) + '\n'
      );
    }
  } catch {
    // Ignore malformed input in the test fixture.
  }
});

setTimeout(() => process.exit(0), 2_000);
