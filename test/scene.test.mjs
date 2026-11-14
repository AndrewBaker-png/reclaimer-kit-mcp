import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodePng,decodePng,parseGlb} from '../src/scene-formats.mjs';
import {renderScene,groundAt} from '../src/scene-renderer.mjs';

test('RGB PNG round trips and malformed PNG is rejected',()=>{
  const rgb=Uint8Array.from({length:12},(_,i)=>i*20),result=decodePng(encodePng(2,2,rgb));
  assert.deepEqual(Array.from(result.data),[0,20,40,255,60,80,100,255,120,140,160,255,180,200,220,255]);
  assert.throws(()=>decodePng(Buffer.alloc(30)),/Invalid/);
});

function glbFixture() {
  const floats=new Float32Array([0,0,0,1,0,0,0,0,1,0,1,0,0,1,0,0,1,0]);
  const j={asset:{version:'2.0'},buffers:[{byteLength:floats.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5126,count:3,type:'VEC3'}],materials:[{name:'hugegrass'}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],nodes:[{children:[1],translation:[3,4,5],scale:[2,2,2]},{mesh:0,name:'terrain'}],scenes:[{nodes:[0]}],scene:0};
  const text=JSON.stringify(j),json=Buffer.from(text+' '.repeat((4-text.length%4)%4)),b=Buffer.alloc(28+json.length+floats.byteLength);
  b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);b.writeUInt32LE(floats.byteLength,20+json.length);b.writeUInt32LE(0x004e4942,24+json.length);Buffer.from(floats.buffer).copy(b,28+json.length);return b;
}
test('GLB hierarchy, scale, Y-up conversion, normals and excluded parts',()=>{
  const b=glbFixture(),m=parseGlb(b)[0];
  assert.deepEqual(Array.from(m.vertices.slice(0,6)),[3,-5,4,0,-0,1]);
  assert.deepEqual(Array.from(m.vertices.slice(8,11)),[5,-5,4]);
  assert.throws(()=>parseGlb(b,{excludeNodes:['terrain']}),/no visible/);
  const bad=Buffer.from(b);bad.writeUInt32LE(1,8);assert.throws(()=>parseGlb(bad),/Invalid/);
});

function ground() {return {name:'hugegrass',vertices:Float64Array.from([-10,-10,0,0,0,1,0,0,10,-10,0,0,0,1,1,0,10,10,0,0,0,1,1,1,-10,10,0,0,0,1,0,1]),indices:[0,1,2,0,2,3]};}
test('terrain height, material texture sampling, sunlight and shadows affect pixels',()=>{
  const floor=ground();assert.equal(groundAt([floor],1,2),0);assert.equal(groundAt([floor],100,100),null);
  const object={name:'pelican_hull',vertices:Float64Array.from([-2,-2,3,0,0,1,0,0,2,-2,3,0,0,1,1,0,0,2,3,0,0,1,0,1]),indices:[0,1,2]};
  const options={width:128,height:96,eye:[12,18,15],target:[0,0,0],sun:[-.5,-.5,1],fog:0};
  const lit=renderScene([floor,object],options),unshadowed=renderScene([floor,object],{...options,shadows:false});
  assert.notDeepEqual(lit,unshadowed);
  assert.notDeepEqual(lit,renderScene([floor,object],{...options,sun:[1,1,.1]}));
  const texture={width:2,height:2,data:Uint8Array.from([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255])};
  assert.notDeepEqual(lit,renderScene([floor,object],{...options,textures:{hugegrass:texture}}));
  assert.ok(decodePng(lit).data.some((v,i)=>i%4===0&&v<80));
});
