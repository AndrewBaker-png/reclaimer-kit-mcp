// Creates a separate test revision via MCP; never changes the input project.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'hugegrass-smoke', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const source = 'kit:hugegrass_mcp_baseline/hugegrass_mcp_baseline.rkscenario';
  const before = await call('read_project', { id: source });
  const name = `hugegrass_bridge_${Date.now()}`;
  const target = before.scenario.changes.moved.find(m => m.kind === 'weapon' && m.index === 1);
  if (!target || target.transform.position[1] !== 2.5) throw Error('Unexpected Hugegrass baseline; refusing smoke test.');
  const position = [...target.transform.position]; position[1] = 12.5;
  const result = await call('set_placement_transform', { source, name, expected_sha256: before.sha256, kind: 'weapon', index: 1, position });
  const after = await call('read_project', { id: result.id });
  const comparison = await call('compare_projects', { before: source, after: result.id });
  if (after.scenario.changes.moved[0].transform.position[1] !== 12.5 || comparison.changes.length !== 1) throw Error('Unexpected edit result.');
  const sourceUnchanged = (await call('read_project', { id: source })).sha256 === before.sha256;
  if (!sourceUnchanged) throw Error('Source changed during smoke test.');
  const report = { passed: true, sourceUnchanged, result, comparison };
  await fs.writeFile(new URL('../projects/smoke-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
