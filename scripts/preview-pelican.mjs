// End-to-end proof: actual Kit export -> CPU renderer -> MCP image response.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'preview-smoke', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const result = await client.callTool({ name: 'render_asset_preview', arguments: { id: 'work:hugegrass_bridge_1794640723071/hugegrass_bridge_1794640723071.rkscenario', tag: 'objects\\vehicles\\pelican_multiplayer\\pelican_multiplayer' } }, undefined, { timeout: 180000 });
  if (result.isError) throw Error(JSON.stringify(result));
  const metadata = JSON.parse(result.content.find(c => c.type === 'text').text);
  const image = result.content.find(c => c.type === 'image');
  if (!image || image.mimeType !== 'image/png') throw Error('MCP returned no PNG.');
  const disk = await fs.readFile(metadata.file);
  if (!disk.equals(Buffer.from(image.data,'base64'))) throw Error('MCP image differs from saved PNG.');
  console.log(JSON.stringify({ ...metadata, mcpImageVerified: true },null,2));
} finally { await client.close(); }
