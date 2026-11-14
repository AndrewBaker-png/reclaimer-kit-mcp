import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {hash} from '../src/projects.mjs';
const client=new Client({name:'saved-placement-preview',version:'1.0.0'});
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],env:{...process.env},stderr:'inherit'}));
  const id='work:hugegrass_pelican_saved_20261114/hugegrass_pelican_saved_20261114.rkscenario';
  const result=await client.callTool({name:'render_scene_preview',arguments:{id,view:process.argv[2]??'pelican'}},undefined,{timeout:180000});
  if(result.isError)throw Error(JSON.stringify(result));
  const metadata=JSON.parse(result.content[0].text),image=result.content.find(c=>c.type==='image');
  const disk=await fs.readFile(metadata.file);
  if(!disk.equals(Buffer.from(image.data,'base64'))||hash(disk)!==metadata.imageSha256||!metadata.previewPelican.savedToScenario)throw Error('Saved preview verification failed.');
  console.log(JSON.stringify({file:metadata.file,map:metadata.map,placement:metadata.previewPelican,buildStatus:metadata.buildStatus,mcpImageVerified:true},null,2));
}finally{await client.close();}
