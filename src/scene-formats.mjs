import { inflateSync, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const b of body) { crc ^= b; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  const h=Buffer.alloc(4), t=Buffer.alloc(4); h.writeUInt32BE(data.length); t.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([h,body,t]);
}
export function encodePng(width,height,rgb) {
  const raw=Buffer.alloc(height*(width*3+1));
  for(let y=0;y<height;y++) Buffer.from(rgb.buffer,rgb.byteOffset+y*width*3,width*3).copy(raw,y*(width*3+1)+1);
  const h=Buffer.alloc(13); h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function decodePng(b) {
  if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw Error('Invalid PNG.');
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20),type=b[25],channels=type===6?4:type===2?3:type===0?1:0;
  if(!channels||b[24]!==8||b[28]!==0||width*height>16777216) throw Error('Unsupported PNG layout.');
  const pieces=[];
  for(let p=8;p+12<=b.length;) {const n=b.readUInt32BE(p);if(p+n+12>b.length)throw Error('Truncated PNG.');if(b.toString('ascii',p+4,p+8)==='IDAT')pieces.push(b.subarray(p+8,p+8+n));p+=n+12;}
  const stride=width*channels,raw=inflateSync(Buffer.concat(pieces),{maxOutputLength:height*(stride+1)}),data=new Uint8Array(width*height*4),decoded=new Uint8Array(height*stride);
  if(raw.length!==height*(stride+1))throw Error('Invalid PNG rows.');
  for(let y=0;y<height;y++) { const filter=raw[y*(stride+1)]; if(filter>4)throw Error('Invalid PNG filter.');
    for(let x=0;x<stride;x++) {const a=x>=channels?decoded[y*stride+x-channels]:0,c=y&&x>=channels?decoded[(y-1)*stride+x-channels]:0,d=y?decoded[(y-1)*stride+x]:0;
      const p=a+d-c,pa=Math.abs(p-a),pb=Math.abs(p-d),pc=Math.abs(p-c),predict=pa<=pb&&pa<=pc?a:pb<=pc?d:c;
      decoded[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,d,Math.floor((a+d)/2),predict][filter])&255;
    }
  }
  for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)data[i*4+c]=decoded[i*channels+(channels===1?0:c)];data[i*4+3]=channels===4?decoded[i*4+3]:255;}
  return {width,height,data};
}

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>Array.from({length:16},(_,i)=>{let s=0;for(let k=0;k<4;k++)s+=a[(i%4)+k*4]*b[k+Math.floor(i/4)*4];return s;});
function matrix(n) {
  if(n.matrix)return n.matrix;
  const [x,y,z,w]=n.rotation??[0,0,0,1],s=n.scale??[1,1,1],t=n.translation??[0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
export function parseGlb(b,{excludeNodes=[]}={}) {
  if(b.length<28||b.toString('ascii',0,4)!=='glTF'||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)throw Error('Invalid GLB.');
  const len=b.readUInt32LE(12);if(b.readUInt32LE(16)!==0x4e4f534a||20+len+8>b.length)throw Error('Missing GLB JSON.');
  const j=JSON.parse(b.toString('utf8',20,20+len));const bin=b.subarray(28+len);
  const components={5126:[4,'readFloatLE'],5125:[4,'readUInt32LE'],5123:[2,'readUInt16LE'],5121:[1,'readUInt8']};
  function accessor(index) {
    const a=j.accessors?.[index],v=j.bufferViews?.[a?.bufferView],c=components[a?.componentType],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a?.type];
    if(!a||!v||!c||!n||a.sparse||a.normalized||v.buffer!==0||a.count>3000000)throw Error('Unsupported GLB accessor.');
    const start=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??c[0]*n;
    const end=start+(a.count-1)*stride+n*c[0];
    if(!Number.isInteger(a.count)||a.count<1||start<0||stride<c[0]*n||end>bin.length||end>(v.byteOffset??0)+v.byteLength)throw Error('GLB accessor out of bounds.');
    const out=new Float64Array(a.count*n);for(let i=0;i<a.count;i++)for(let k=0;k<n;k++){const value=bin[c[1]](start+i*stride+k*c[0]);if(!Number.isFinite(value))throw Error('Nonfinite GLB coordinate.');out[i*n+k]=value;}return out;
  }
  const result=[],visited=new Set();
  function visit(index,parent,ancestors) {
    if(ancestors.has(index))throw Error('GLB node cycle.');const n=j.nodes?.[index];if(!n)throw Error('Missing GLB node.');
    if(excludeNodes.includes(n.name))return;
    const m=mul(parent,matrix(n));
    if(n.mesh!==undefined)for(const prim of j.meshes[n.mesh].primitives) {
      if((prim.mode??4)!==4)throw Error('Only triangle GLB meshes supported.');
      const name=j.materials?.[prim.material]?.name??'default';
      // Halo authoring-only surfaces are not visible render geometry.
      if(/^[+@]/.test(name))continue;
      const pos=accessor(prim.attributes.POSITION),norm=prim.attributes.NORMAL===undefined?null:accessor(prim.attributes.NORMAL),uv=prim.attributes.TEXCOORD_0===undefined?null:accessor(prim.attributes.TEXCOORD_0),indices=prim.indices===undefined?Float64Array.from({length:pos.length/3},(_,i)=>i):accessor(prim.indices);
      if(indices.length%3||Array.from(indices).some(i=>!Number.isInteger(i)||i<0||i>=pos.length/3))throw Error('Invalid GLB indices.');
      // Inverse transpose 3x3, so nonuniformly scaled instance normals stay correct.
      const a=m[0],d=m[1],g=m[2],bb=m[4],e=m[5],h=m[6],c=m[8],f=m[9],ii=m[10];
      const cof=[e*ii-f*h,f*g-d*ii,d*h-e*g,c*h-bb*ii,a*ii-c*g,bb*g-a*h,bb*f-c*e,c*d-a*f,a*e-bb*d];
      const determinant=a*cof[0]+bb*cof[1]+c*cof[2];if(Math.abs(determinant)<1e-15)throw Error('Singular GLB transform.');
      const vertices=new Float64Array(pos.length/3*8);
      for(let i=0;i<pos.length/3;i++) {const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2],o=i*8;
        vertices[o]=m[0]*x+m[4]*y+m[8]*z+m[12];vertices[o+1]=-(m[2]*x+m[6]*y+m[10]*z+m[14]);vertices[o+2]=m[1]*x+m[5]*y+m[9]*z+m[13];
        const nn=norm?[norm[i*3],norm[i*3+1],norm[i*3+2]]:[0,1,0];
        const nx=(cof[0]*nn[0]+cof[1]*nn[1]+cof[2]*nn[2])/determinant,ny=(cof[3]*nn[0]+cof[4]*nn[1]+cof[5]*nn[2])/determinant,nz=(cof[6]*nn[0]+cof[7]*nn[1]+cof[8]*nn[2])/determinant;
        const l=Math.hypot(nx,ny,nz)||1;vertices[o+3]=nx/l;vertices[o+4]=-nz/l;vertices[o+5]=ny/l;vertices[o+6]=uv?.[i*2]??0;vertices[o+7]=uv?.[i*2+1]??0;
      }
      result.push({name,node:n.name,vertices,indices});
    }
    const next=new Set(ancestors);next.add(index);for(const child of n.children??[])visit(child,m,next);visited.add(index);
  }
  for(const index of j.scenes?.[j.scene??0]?.nodes??[])visit(index,identity(),new Set());
  if(!result.length)throw Error('GLB has no visible triangles.');return result;
}
