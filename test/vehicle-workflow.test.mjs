import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectVehicles} from '../src/map-placements.mjs';
import {Projects} from '../src/projects.mjs';
import {addVehicle} from '../src/vehicle-workflow.mjs';
import {scenePreview} from '../src/scene-preview.mjs';

const tag='objects\\vehicles\\pelican_multiplayer\\pelican_multiplayer';
function mapFixture(shift=-0x1000) {
  const b=Buffer.alloc(0x7000),base=0x100000000,magic=base-0x4000,ptr=offset=>(offset+magic)/4;
  b.writeUInt32LE(0x68656164,0);b.writeUInt32LE(13,4);b.writeUInt32LE(b.length,8);
  b.writeBigUInt64LE(BigInt(base),736);b.writeBigUInt64LE(BigInt(0x4100+magic),744);
  b.writeInt32LE(shift,1228);b.writeInt32LE(shift,1236);b.writeUInt32LE(0x4000-shift,1260);
  const names=Buffer.from('levels\\test\0'+tag+'\0');names.copy(b,0x6000);
  b.writeUInt32LE(0x6000-shift,36);b.writeUInt32LE(names.length,40);b.writeUInt32LE(0x6100-shift,44);
  b.writeUInt32LE(0,0x6100);b.writeUInt32LE('levels\\test'.length+1,0x6104);b.write('levels\\test',224);
  b.writeUInt32LE(2,0x4100);b.writeBigUInt64LE(BigInt(0x4200+magic),0x4108);b.writeUInt32LE(2,0x4110);b.writeBigUInt64LE(BigInt(0x4300+magic),0x4118);
  b.write('rncs',0x4200);b.write('ihev',0x4210);b.writeInt16LE(0,0x4300);b.writeUInt32LE(ptr(0x4400),0x4304);b.writeInt16LE(1,0x4308);b.writeUInt32LE(ptr(0x4800),0x430c);
  b.writeUInt32LE(1,0x44e4);b.writeUInt32LE(ptr(0x5100),0x44e8);b.writeUInt32LE(1,0x44f0);b.writeUInt32LE(ptr(0x5000),0x44f4);
  b.writeUInt32LE(1,0x500c);b.writeUInt32LE(32,0x5104);b.writeFloatLE(12.5,0x5108);b.writeFloatLE(-2,0x510c);b.writeFloatLE(100,0x5110);
  return b;
}
async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vehicle-workflow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'kit','base');await fs.mkdir(dir,{recursive:true});
  const map=path.join(root,'hugeass_remastered_mcc.map');await fs.writeFile(map,mapFixture());
  const scenario={format:2,map:{file:map,id:1},changes:{moved:[],added:[]}};
  await fs.writeFile(path.join(dir,'base.rkscenario'),JSON.stringify(scenario));
  const config={roots:{kit:path.join(root,'kit'),work:path.join(root,'work')}};
  return {map,root,config,projects:new Projects(config),id:'kit:base/base.rkscenario'};
}
test('read-only map inspector resolves signed section offsets, palette and transform',async t=>{
  const f=await setup(t),m=await inspectVehicles(f.map);
  assert.equal(m.vehicleCount,1);assert.equal(m.vehicles[0].tag.name,tag);
  assert.deepEqual(m.vehicles[0].position,[12.5,-2,100]);assert.equal(m.vehicles[0].scale,0);
  const bad=mapFixture();bad.writeInt16LE(3,0x5100);await fs.writeFile(f.map,bad);
  await assert.rejects(inspectVehicles(f.map),/palette index/);
});
test('save derives real vehicle/palette identity, preserves source and scale sentinel',async t=>{
  const f=await setup(t),before=await f.projects.read(f.id),mapBefore=await fs.readFile(f.map);
  const result=await addVehicle(f.projects,{source:f.id,name:'placed',expected_sha256:before.sha256,tag,position:[0,250,122.7]});
  const saved=await f.projects.read(result.id);assert.deepEqual(saved.scenario.changes.added[0],{kind:'vehicle',template:{Own:0},palette:{Own:0},transform:{position:[0,250,122.7],rotation:[0,0,0],scale:0}});
  assert.equal((await f.projects.read(f.id)).sha256,before.sha256);assert.deepEqual(await fs.readFile(f.map),mapBefore);
  await assert.rejects(addVehicle(f.projects,{source:f.id,name:'bad',expected_sha256:before.sha256,tag:'invented',position:[0,0,0]}),/verified template/);
  await assert.rejects(addVehicle(f.projects,{source:f.id,name:'stale',expected_sha256:'0'.repeat(64),tag,position:[0,0,0]}),/Source changed/);
});
test('saved preview refuses missing and stale build instead of silently staging',async t=>{
  const f=await setup(t);
  await assert.rejects(scenePreview(f.config,f.projects,{id:f.id}),/No saved build/);
  await fs.writeFile(path.join(f.root,'kit','base','latest-build.json'),JSON.stringify({project:f.id,scenarioSha256:'stale'}));
  await assert.rejects(scenePreview(f.config,f.projects,{id:f.id}),/does not match/);
});
