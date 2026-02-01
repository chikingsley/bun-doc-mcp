import { expect, test, beforeAll, afterAll, describe } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('MCP Server E2E', () => {
  let serverProcess: ReturnType<typeof spawn>;

  beforeAll(async () => {
    // Build the server first
    const buildResult = await Bun.$`bun run build`.quiet();
    if (buildResult.exitCode !== 0) {
      throw new Error('Failed to build server');
    }

    // Start the server process
    const serverPath = join(process.cwd(), 'dist', 'index.js');
    serverProcess = spawn('bun', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait a bit for server to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test('server starts without errors', () => {
    expect(serverProcess).toBeDefined();
    expect(serverProcess.pid).toBeGreaterThan(0);
  });

  test('can send initialize request', async () => {
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    };

    // Send the request
    serverProcess.stdin!.write(JSON.stringify(initRequest) + '\n');

    // Wait for response
    let response = '';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      serverProcess.stdout!.on('data', (data) => {
        response += data.toString();
        if (response.includes('\n')) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      });
    });

    // Parse response
    const lines = response.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      throw new Error('No response received');
    }
    const jsonResponse = JSON.parse(lastLine);

    expect(jsonResponse).toHaveProperty('result');
    expect(jsonResponse.result).toHaveProperty('protocolVersion');
    expect(jsonResponse.result).toHaveProperty('serverInfo');
  });

  test('can list tools after initialization', async () => {
    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };

    serverProcess.stdin!.write(JSON.stringify(listToolsRequest) + '\n');

    let response = '';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      serverProcess.stdout!.on('data', (data) => {
        response += data.toString();
        if (response.includes('\n')) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      });
    });

    const lines = response.trim().split('\n');
    const jsonLine = lines.find((line: string) => line.includes('"tools"'));
    expect(jsonLine).toBeDefined();

    if (jsonLine) {
      const jsonResponse = JSON.parse(jsonLine);
      expect(jsonResponse.result.tools).toBeDefined();
      expect(jsonResponse.result.tools.length).toBeGreaterThan(0);

      const toolNames = jsonResponse.result.tools.map(
        (t: { name: string }) => t.name
      );
      expect(toolNames).toContain('search_bun_docs');
      expect(toolNames).toContain('read_bun_doc');
    }
  });
});
