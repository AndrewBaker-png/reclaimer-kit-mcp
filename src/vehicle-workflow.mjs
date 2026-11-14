import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectVehicles } from './map-placements.mjs';
import { validateTransform } from './projects.mjs';

export async function fileHash(file) {const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
export async function addVehicle(projects,{source,name,expected_sha256,tag,position,rotation=[0,0,0]}) {
  const current=await projects.read(source);if(current.sha256!==expected_sha256)throw Error('Source changed. Read it again.');
  const map=await inspectVehicles(current.scenario.map.file),template=map.vehicles.find(v=>v.tag?.name===tag);
  if(!template)throw Error('An existing vehicle of this exact tag is required as a verified template.');
  const transform={position,rotation,scale:template.scale};validateTransform(transform);
  const addition={kind:'vehicle',template:{Own:template.index},palette:{Own:template.paletteIndex},transform};
  const revision=await projects.writeRevision(source,name,expected_sha256,next=>{next.changes.added??=[];next.changes.added.push(addition);});
  return {...revision,addition,templateVehicle:template.index,tag};
}

export async function buildScenario(config,projects,{id,expected_sha256},progress=()=>{}) {
  const project=await projects.read(id);if(project.sha256!==expected_sha256)throw Error('Source changed. Read it again.');
  const sourceFile=await projects.resolve(id),baseFile=await fs.realpath(project.scenario.map.file),before=await inspectVehicles(baseFile);
  const parent=path.join(config.roots.work,'builds');await fs.mkdir(parent,{recursive:true});
  const job=await fs.mkdtemp(path.join(parent,'vehicle-')),profile=path.join(job,'profile'),name='pelican_roundtrip';
  const packageDir=path.join(profile,'Mods',name),mapFile=path.join(packageDir,`${name}.map`);
  const baseSha256=await fileHash(baseFile);
  const run=async args=>{try{const r=await promisify(execFile)(config.editor,args,{cwd:path.dirname(config.editor),env:{...process.env,RECLAIMER_PROFILE_DIR:profile},windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});return {exitCode:0,...r};}catch(e){return {exitCode:e.code??null,stdout:e.stdout??'',stderr:e.stderr??'',error:e.message};}};
  progress('Compiling saved scenario');
  const compile=await run(['--kit-tool','compile','--scenario',sourceFile,'--name',name]);
  await fs.writeFile(path.join(job,'compile.log'),compile.stdout+'\n'+compile.stderr);
  const after=await inspectVehicles(mapFile); // A failed/incomplete map must not be treated as a valid build.
  // The compiler can write the map before rejecting malformed pre-existing audio.
  // Preserve the source banks byte-for-byte, never fabricate or truncate sound data.
  const sourceAudio=path.join(path.dirname(path.dirname(baseFile)),'halo3','fmod','pc');
  if(await fs.access(sourceAudio).then(()=>true,()=>false)) {
    const target=path.join(packageDir,'halo3','fmod','pc');await fs.mkdir(target,{recursive:true});
    for(const entry of await fs.readdir(sourceAudio,{withFileTypes:true})){
      if(entry.isSymbolicLink()||!entry.isFile())throw Error('Unexpected audio sidecar layout.');
      await fs.copyFile(path.join(sourceAudio,entry.name),path.join(target,entry.name));
    }
  }
  progress('Comparing compiled vehicle records and base-map diagnostics');
  if(after.vehicleCount!==before.vehicleCount+(project.scenario.changes.added??[]).filter(a=>a.kind==='vehicle').length)throw Error('Unexpected compiled vehicle count.');
  const unchangedBaseVehicles=before.vehicles.every((v,i)=>v.rawHex===after.vehicles[i]?.rawHex);
  if(!unchangedBaseVehicles)throw Error('Existing vehicle records changed; this workflow requires append-only vehicle edits.');
  const additions=after.vehicles.slice(before.vehicleCount);
  const desired=(project.scenario.changes.added??[]).filter(a=>a.kind==='vehicle');
  for(let i=0;i<desired.length;i++){
    const d=desired[i],a=additions[i],tag=before.palette[d.palette.Own]?.tag?.name;
    if(a.tag?.name!==tag||!a.position.every((v,k)=>Math.abs(v-d.transform.position[k])<1e-4)||!a.rotation.every((v,k)=>Math.abs(v-d.transform.rotation[k])<1e-5)||a.scale!==Math.fround(d.transform.scale))throw Error('Compiled addition does not match the saved scenario.');
  }
  const baselineCheck=await run(['--verify-map',baseFile]),compiledCheck=await run(['--verify-map',mapFile]);
  await fs.writeFile(path.join(job,'verify-base.log'),baselineCheck.stdout+'\n'+baselineCheck.stderr);
  await fs.writeFile(path.join(job,'verify-compiled.log'),compiledCheck.stdout+'\n'+compiledCheck.stderr);
  const errors=r=>(r.stdout+'\n'+r.stderr).split(/\r?\n/).filter(s=>s.startsWith('error:')).sort();
  const baseErrors=errors(baselineCheck),compiledErrors=errors(compiledCheck),newErrors=compiledErrors.filter(e=>!baseErrors.includes(e));
  if((await projects.read(id)).sha256!==project.sha256||await fileHash(baseFile)!==baseSha256)throw Error('Source changed during build.');
  const report={format:1,project:id,scenarioSha256:project.sha256,baseMap:baseFile,baseMapSha256:baseSha256,mapFile,mapSha256:await fileHash(mapFile),compileExitCode:compile.exitCode,packageComplete:compile.exitCode===0,compileIssue:compile.exitCode===0?null:compile.stderr.trim().split(/\r?\n/).at(-1),vehicleCountBefore:before.vehicleCount,vehicleCountAfter:after.vehicleCount,unchangedBaseVehicles,additions,baselineVerificationExitCode:baselineCheck.exitCode,compiledVerificationExitCode:compiledCheck.exitCode,baselineErrors:baseErrors.length,compiledErrors:compiledErrors.length,newErrors,sourceUnchanged:true,gameplayTested:false,job,created:new Date().toISOString()};
  await fs.writeFile(path.join(job,'build.json'),JSON.stringify(report,null,2),{flag:'wx'});
  // A small pointer accompanies the scenario; large compiled assets stay outside
  // its revision directory so subsequent revisions do not duplicate the map.
  await fs.writeFile(path.join(path.dirname(sourceFile),'latest-build.json'),JSON.stringify(report,null,2));
  return report;
}
