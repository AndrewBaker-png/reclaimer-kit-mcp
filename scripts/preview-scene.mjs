import fs from 'node:fs/promises';
import { Projects } from '../src/projects.mjs';
import { scenePreview } from '../src/scene-preview.mjs';
const config=JSON.parse(await fs.readFile(new URL('../config.local.json',import.meta.url)));
const result=await scenePreview(config,new Projects(config),{id:'work:hugegrass_bridge_1794640723071/hugegrass_bridge_1794640723071.rkscenario',placement_source:'staged',view:process.argv[2]??'pelican'},s=>console.error(s));
const meta=JSON.parse(result.content[0].text);console.log(JSON.stringify({file:meta.file,triangles:meta.triangles,placement:meta.previewPelican.position,warnings:meta.warnings},null,2));
