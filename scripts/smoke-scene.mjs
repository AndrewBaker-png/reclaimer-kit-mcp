import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {hash} from '../src/projects.mjs';
const client=new Client({name:'scene-smoke',version:'1.0.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],env:{...process.env},stderr:'inherit'}));
  const id='work:hugegrass_bridge_1794640723071/hugegrass_bridge_1794640723071.rkscenario';
  const before=await client.callTool({name:'read_project',arguments:{id}});
  const result=await client.callTool({name:'render_scene_preview',arguments:{id,placement_source:'staged',view:process.argv[2]??'overview'}},undefined,{timeout:180000});
  if(result.isError)throw Error(JSON.stringify(result));
  const metadata=JSON.parse(result.content[0].text),image=result.content.find(c=>c.type==='image'),disk=await fs.readFile(metadata.file);
  if(image?.mimeType!=='image/png'||!disk.equals(Buffer.from(image.data,'base64'))||hash(disk)!==metadata.imageSha256)throw Error('MCP PNG verification failed.');
  const after=await client.callTool({name:'read_project',arguments:{id}});
  if(JSON.parse(before.content[0].text).sha256!==JSON.parse(after.content[0].text).sha256)throw Error('Source scenario changed.');
  console.log(JSON.stringify({file:metadata.file,triangles:metadata.triangles,textures:metadata.textures.length,sections:metadata.terrainSections.length,mcpImageVerified:true,sourceUnchanged:true,warnings:metadata.warnings},null,2));
} finally {await client.close();}
