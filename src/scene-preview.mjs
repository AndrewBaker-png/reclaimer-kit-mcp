import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hash } from './projects.mjs';
import { parseGlb, decodePng } from './scene-formats.mjs';
import { bounds, groundAt, translate, renderScene } from './scene-renderer.mjs';
import { inspectVehicles } from './map-placements.mjs';
import { fileHash } from './vehicle-workflow.mjs';

const level='levels\\multi\\hugeass_remastered_ed\\';
const terrain=['hugegrass_ed','hangar01','hangar02','citadel','cartographer','caveblue','cavered','waterworks','hugegrass_ed_b'];
const pelican='objects\\vehicles\\pelican_multiplayer\\pelican_multiplayer';
const bitmapTags={
  hugegrass_mask:level+'bitmaps\\hugegrass',
  hugegrass:'levels\\solo\\100_citadel\\bitmaps\\nature\\ground_veg_gravel_detail',
  ground_humus:'levels\\solo\\100_citadel\\bitmaps\\nature\\ground_humus_detail',
  hugecliff:'levels\\solo\\100_citadel\\bitmaps\\nature\\cliff_high_veg_dif',
  pelican_hull:'objects\\vehicles\\pelican_flyable\\bitmaps\\pelican_hull',
  pelican_instances:'objects\\vehicles\\pelican\\bitmaps\\pelican_instances',
  pelican_interior:'objects\\vehicles\\pelican\\bitmaps\\pelican_interior',
  rock_basic:'levels\\solo\\100_citadel\\bitmaps\\nature\\rock_basic',
  cit_tree_bark:'levels\\solo\\100_citadel\\bitmaps\\cit_tree_bark',
  cit_tree_leafa:'levels\\solo\\100_citadel\\bitmaps\\cit_tree_leafa',
  cit_tree_leafb:'levels\\solo\\100_citadel\\bitmaps\\cit_tree_leafb',
  panel_ext_tile:'levels\\solo\\100_citadel\\bitmaps\\panel_ext_tile'
};

export async function scenePreview(config,projects,{id,view='pelican',sun_azimuth=45,sun_elevation=65,shadows=true,placement_source='saved'},progress=()=>{}) {
  const source=await projects.read(id);let map=await fs.realpath(source.scenario.map.file),build=null,savedVehicle=null;
  if(path.basename(map).toLowerCase()!=='hugeass_remastered_mcc.map')throw Error('The current scene preset supports Hugegrass only.');
  if(!['saved','staged'].includes(placement_source))throw Error('Unknown placement source.');
  if(placement_source==='saved') {
    const manifest=path.join(path.dirname(await projects.resolve(id)),'latest-build.json');
    try{build=JSON.parse(await fs.readFile(manifest,'utf8'));}catch{throw Error('No saved build available. Compile this revision first, or explicitly request a staged preview.');}
    if(build.scenarioSha256!==source.sha256||build.project!==id)throw Error('Build does not match this saved revision. Recompile first.');
    const root=await fs.realpath(path.join(config.roots.work,'builds'));map=await fs.realpath(build.mapFile);const relative=path.relative(root,map);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Compiled map is outside the build directory.');
    if(await fileHash(map)!==build.mapSha256)throw Error('Compiled map changed. Recompile first.');
    const compiled=await inspectVehicles(map);
    const matches=compiled.vehicles.filter(v=>v.index>=build.vehicleCountBefore&&v.tag?.name===pelican);
    if(matches.length!==1)throw Error('Saved preview currently requires exactly one newly added Pelican.');
    savedVehicle=matches[0];
    if(savedVehicle.rotation.some(v=>Math.abs(v)>1e-7))throw Error('Saved preview currently supports zero-rotation Pelican placements only.');
  }
  if(!['pelican','overview'].includes(view)||!Number.isFinite(sun_azimuth)||!Number.isFinite(sun_elevation)||sun_elevation<5||sun_elevation>85)throw Error('Invalid scene options.');
  const stat=await fs.stat(map),editorStat=await fs.stat(config.editor),root=path.join(config.roots.work,'previews');await fs.mkdir(root,{recursive:true});
  const key=hash(JSON.stringify([map,stat.size,stat.mtimeMs,config.editor,editorStat.size,editorStat.mtimeMs,'scene-export-v1']));
  const cache=path.join(root,'scene-cache',key);await fs.mkdir(cache,{recursive:true});
  const provenance=[];
  async function exported(tag,group,format) {
    const rel=tag.split('\\').join(path.sep)+(format==='png'?'_0.png':'.glb'),file=path.join(cache,rel);
    if(!await fs.access(file).then(()=>true,()=>false)) {
      progress(`Exporting ${tag}`);
      // Export to an isolated staging directory; only cache completed files.
      const temp=await fs.mkdtemp(path.join(cache,'export-'));
      await promisify(execFile)(config.editor,['--kit-tool','export','--map',map,'--tag',tag,'--group',group,'--format',format,'--out',temp],{timeout:120000,maxBuffer:2*1024*1024,windowsHide:true,cwd:path.dirname(config.editor)});
      await fs.mkdir(path.dirname(file),{recursive:true});await fs.rename(path.join(temp,rel),file);
    }
    if((await fs.stat(file)).size>128*1024*1024)throw Error('Export too large.');
    const data=await fs.readFile(file);provenance.push({tag,group,file,sha256:hash(data)});return data;
  }
  let meshes=[];
  for(const name of terrain)meshes.push(...parseGlb(await exported(level+name,'sbsp','glb')));
  const terrainBounds=bounds(meshes),textures={},warnings=[];
  for(const [name,tag] of Object.entries(bitmapTags)) {
    try {textures[name]=decodePng(await exported(tag,'bitm','png'));}
    catch(e){warnings.push(`Texture ${name} unavailable: ${e.message}`);}
  }
  const ship=parseGlb(await exported(pelican,'mode','glb'),{excludeNodes:['engine_bl_major','engine_br_major','engine_fl_major','engine_fr_major']});
  let placement=savedVehicle?[...savedVehicle.position]:null;
  if(!savedVehicle)for(const [x,y] of [[0,0],[-250,0],[250,0],[-500,0],[0,250],[0,-250]]) {
    const z=groundAt(meshes,x,y);if(z===null)continue;
    const nearby=[[12,0],[-12,0],[0,12],[0,-12]].map(([dx,dy])=>groundAt(meshes,x+dx,y+dy));
    if(nearby.every(n=>n!==null&&Math.abs(n-z)<1.5)){placement=[x,y,z];break;}
  }
  if(!placement)throw Error('No flat grass surface found for the preview Pelican.');
  if(savedVehicle){const scale=savedVehicle.scale===0?1:savedVehicle.scale;for(const m of ship)for(let i=0;i<m.vertices.length;i+=8)for(let k=0;k<3;k++)m.vertices[i+k]*=scale;}
  else {const shipBounds=bounds(ship);placement[2]+=.08-shipBounds.min[2];}
  translate(ship,placement);meshes.push(...ship);
  const target=view==='pelican'?[placement[0],placement[1],placement[2]+1]:terrainBounds.center;
  const span=Math.max(terrainBounds.max[0]-terrainBounds.min[0],terrainBounds.max[1]-terrainBounds.min[1]);
  const eye=view==='pelican'?[target[0]+15,target[1]+19,target[2]+8]:[target[0]+span*.55,target[1]-span*.8,target[2]+span*.8];
  const sa=sun_azimuth*Math.PI/180,se=sun_elevation*Math.PI/180,sun=[Math.cos(sa)*Math.cos(se),Math.sin(sa)*Math.cos(se),Math.sin(se)];
  progress(`Rendering ${meshes.reduce((s,m)=>s+m.indices.length/3,0)} triangles`);
  const png=renderScene(meshes,{eye,target,sun,shadows,textures,fog:view==='pelican'?.0013:.00025,marker:view==='overview'?placement:null});
  const after=await fs.stat(map);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Source map changed during preview. Retry.');
  const output=await fs.mkdtemp(path.join(root,'scene-')),file=path.join(output,'preview.png');
  const fallback=[...new Set(meshes.map(m=>m.name.replace(/^[%!@]+/,'').split('\\').at(-1)))].filter(n=>!textures[n]);
  const metadata={type:'textured-scene-preview',file,project:id,scenarioSha256:source.sha256,map,mapSize:stat.size,mapMtime:stat.mtime.toISOString(),view,camera:{eye,target,fov:54},lighting:{sun_azimuth,sun_elevation,shadows,ambient:.5,source:'Preview lighting, not extracted Halo lightmaps'},terrainSections:terrain,triangles:meshes.reduce((s,m)=>s+m.indices.length/3,0),textures:Object.keys(textures),fallbackMaterials:fallback,previewPelican:{tag:pelican,position:placement,excludedDamagedNodes:['engine_bl_major','engine_br_major','engine_fl_major','engine_fr_major'],savedToScenario:false},desktopCapture:false,scenarioEditsApplied:false,lockedSessionTested:false,provenance,imageSha256:hash(png),warnings,limitations:['Base BSP geometry and BSP instances only; other scenario vehicles, weapons, scenery and placement deltas are not reconstructed.','Texture associations use the explicit Hugegrass preview palette, not parsed Halo shader graphs. Unmapped materials use approximate colors. Terrain blend channels, tint and world tiling are approximations.','Preview sunlight, shadow maps, sky fill and distance haze; original lightmaps, reflection probes, water effects and particle effects are not reproduced.','Pelican is staged on a flat grass surface for the preview only; no map or scenario changes are made.'],created:new Date().toISOString()};
  metadata.placementSource=placement_source;
  metadata.locatorMarker=view==='overview'?'Cyan ring marks the selected Pelican position':null;
  if(savedVehicle){
    metadata.previewPelican={...metadata.previewPelican,savedToScenario:true,compiledVehicleIndex:savedVehicle.index,rotation:savedVehicle.rotation,scale:savedVehicle.scale};
    metadata.scenarioEditsApplied=true;metadata.sceneCoverage='Compiled BSPs and selected added vehicle; other scenario objects not rendered';
    metadata.compiledMapSha256=build.mapSha256;metadata.buildStatus={packageComplete:build.packageComplete,compileIssue:build.compileIssue,newVerificationErrors:build.newErrors};
    metadata.limitations[0]='Compiled BSP geometry, BSP instances and selected saved Pelican only; other scenario vehicles, weapons and separately placed scenery are not rendered.';
    metadata.limitations[3]='Pelican transform read from the compiled .map after checking its hash and saved-revision hash. Not a gameplay or collision test.';
  }
  await fs.writeFile(file,png,{flag:'wx'});await fs.writeFile(path.join(output,'preview.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
  return {content:[{type:'text',text:JSON.stringify(metadata,null,2)},{type:'image',mimeType:'image/png',data:png.toString('base64')}]};
}
