// Diagnostic client: node scripts/call.mjs tool_name [arguments.json]
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const name = process.argv[2] || 'kit_status';
const args = process.argv[3] ? JSON.parse(await fs.readFile(process.argv[3], 'utf8')) : {};
const client = new Client({ name: 'reclaimer-diagnostic', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const result = await client.callTool({ name, arguments: args });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally { await client.close(); }
