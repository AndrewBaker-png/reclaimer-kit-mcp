import fs from 'node:fs/promises';
import {Projects} from '../src/projects.mjs';
import {addVehicle,buildScenario} from '../src/vehicle-workflow.mjs';
const config=JSON.parse(await fs.readFile(new URL('../config.local.json',import.meta.url))),projects=new Projects(config);
const source='work:hugegrass_bridge_1794640723071/hugegrass_bridge_1794640723071.rkscenario',current=await projects.read(source);
const result=await addVehicle(projects,{source,name:'hugegrass_pelican_saved_20261114',expected_sha256:current.sha256,tag:'objects\\vehicles\\pelican_multiplayer\\pelican_multiplayer',position:[0,250,122.72416339825911]});
console.log(JSON.stringify(result));
const build=await buildScenario(config,projects,{id:result.id,expected_sha256:result.sha256},s=>console.error(s));
console.log(JSON.stringify(build,null,2));
