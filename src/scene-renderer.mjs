import { encodePng } from './scene-formats.mjs';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const unit=a=>{const l=Math.hypot(...a)||1;return a.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function bounds(meshes) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const m of meshes)for(let i=0;i<m.vertices.length;i+=8)for(let k=0;k<3;k++){min[k]=Math.min(min[k],m.vertices[i+k]);max[k]=Math.max(max[k],m.vertices[i+k]);}
  return {min,max,center:min.map((x,i)=>(x+max[i])/2)};
}
export function groundAt(meshes,x,y) {
  let best=-Infinity;
  for(const m of meshes){if(!/hugegrass$/.test(m.name))continue;const v=m.vertices;
    for(let i=0;i<m.indices.length;i+=3){const a=m.indices[i]*8,b=m.indices[i+1]*8,c=m.indices[i+2]*8;
      const area=(v[b]-v[a])*(v[c+1]-v[a+1])-(v[b+1]-v[a+1])*(v[c]-v[a]);if(Math.abs(area)<1e-9)continue;
      const u=((v[b]-x)*(v[c+1]-y)-(v[b+1]-y)*(v[c]-x))/area;
      const w=((v[c]-x)*(v[a+1]-y)-(v[c+1]-y)*(v[a]-x))/area,t=1-u-w;
      if(Math.min(u,w,t)>=-1e-8)best=Math.max(best,u*v[a+2]+w*v[b+2]+t*v[c+2]);
    }
  }return Number.isFinite(best)?best:null;
}
export function translate(meshes,p) { for(const m of meshes)for(let i=0;i<m.vertices.length;i+=8)for(let k=0;k<3;k++)m.vertices[i+k]+=p[k]; }

function textureSample(tex,u,v,footprint=0) {
  if(footprint>1){
    tex.mips??=[tex];const level=Math.min(Math.ceil(Math.log2(Math.max(tex.width,tex.height))),Math.max(0,Math.floor(Math.log2(footprint))));
    while(tex.mips.length<=level){const prev=tex.mips.at(-1),width=Math.max(1,prev.width>>1),height=Math.max(1,prev.height>>1),data=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){let s=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)s+=prev.data[(Math.min(y*2+dy,prev.height-1)*prev.width+Math.min(x*2+dx,prev.width-1))*4+c];data[(y*width+x)*4+c]=s/4;}
      tex.mips.push({width,height,data});
    }tex=tex.mips[level];
  }
  const x=((u%1+1)%1)*(tex.width-1),y=((v%1+1)%1)*(tex.height-1),ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const result=[0,0,0,0];
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const p=(Math.min(iy+dy,tex.height-1)*tex.width+Math.min(ix+dx,tex.width-1))*4,w=(dx?fx:1-fx)*(dy?fy:1-fy);for(let c=0;c<4;c++)result[c]+=tex.data[p+c]*w;}
  return result;
}
export function material(name,textures={}) {
  const clean=name.replace(/^[%!@]+/,'').split('\\').at(-1);
  let color=[.43,.47,.48];
  if(/grass/.test(clean))color=[.28,.38,.16];else if(/cliff|rock/.test(clean))color=[.36,.35,.31];else if(/leaf/.test(clean))color=[.14,.25,.09];else if(/bark|branch/.test(clean))color=[.25,.19,.12];else if(/pelican/.test(clean))color=[.25,.30,.22];else if(/glass/.test(clean))color=[.09,.22,.28];else if(/blue/.test(clean))color=[.22,.35,.43];
  const tex=textures[clean];return {name:clean,color,texture:tex,alphaTest:/leaf|branch|decal|net/.test(clean),emission:/light|screen|thrust/.test(clean)?0.15:0};
}

function basis(direction) {const forward=unit(direction),right=unit(cross([0,0,1],forward)),up=cross(forward,right);return {forward,right,up};}
function raster(meshes,view,width,height,callback) {
  const edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
  for(const mesh of meshes){const vertices=mesh.vertices,projected=new Array(vertices.length/8);
    for(let i=0;i<projected.length;i++){const p=Array.from(vertices.subarray(i*8,i*8+8)),delta=sub(p.slice(0,3),view.eye);p.push(dot(delta,view.right),dot(delta,view.up),dot(delta,view.forward));projected[i]=p;}
    for(let i=0;i<mesh.indices.length;i+=3){let poly=[projected[mesh.indices[i]],projected[mesh.indices[i+1]],projected[mesh.indices[i+2]]];
      if(view.perspective){const out=[];for(let j=0;j<3;j++){const a=poly[j],b=poly[(j+1)%3],ina=a[10]>=.1,inb=b[10]>=.1;if(ina)out.push(a);if(ina!==inb){const t=(.1-a[10])/(b[10]-a[10]);out.push(a.map((x,k)=>x+t*(b[k]-x)));}}poly=out;}
      for(let j=1;j+1<poly.length;j++){const pts=[poly[0],poly[j],poly[j+1]],p=pts.map(v=>{const q=view.perspective?view.scale/v[10]:view.scale;return [width/2+v[8]*q,height/2-v[9]*q];});
        const area=edge(p[0],p[1],p[2][0],p[2][1]);if(Math.abs(area)<1e-8)continue;
        const uvRate=Math.max(...[0,1,2].map(k=>{const l=(k+1)%3;return Math.hypot(pts[k][6]-pts[l][6],pts[k][7]-pts[l][7])/Math.max(1,Math.hypot(p[k][0]-p[l][0],p[k][1]-p[l][1]));}));
        const x0=Math.max(0,Math.floor(Math.min(...p.map(v=>v[0])))),x1=Math.min(width-1,Math.ceil(Math.max(...p.map(v=>v[0])))),y0=Math.max(0,Math.floor(Math.min(...p.map(v=>v[1])))),y1=Math.min(height-1,Math.ceil(Math.max(...p.map(v=>v[1]))));
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          let a=edge(p[1],p[2],x+.5,y+.5)/area,b=edge(p[2],p[0],x+.5,y+.5)/area,c=1-a-b;if(Math.min(a,b,c)<-1e-8)continue;
          if(view.perspective){a/=pts[0][10];b/=pts[1][10];c/=pts[2][10];const sum=a+b+c;a/=sum;b/=sum;c/=sum;}
          const depth=a*pts[0][10]+b*pts[1][10]+c*pts[2][10];callback(x,y,depth,pts,a,b,c,mesh,uvRate);
        }
      }
    }
  }
}

export function renderScene(meshes,{width=1280,height=800,eye,target,sun=[-.45,-.55,.8],sunStrength=1,ambient=.5,shadows=true,fog=.001,textures={},marker=null}) {
  if(![width,height].every(n=>Number.isInteger(n)&&n>=64&&n<=1920)||!eye?.every(Number.isFinite)||!target?.every(Number.isFinite)||Math.hypot(...sub(eye,target))<.01)throw Error('Invalid scene camera.');
  const camera={...basis(sub(target,eye)),eye,perspective:true,scale:height/(2*Math.tan(27*Math.PI/180))};
  // basis points right for a camera looking toward a scene; invert to avoid mirroring.
  camera.right=camera.right.map(x=>-x);camera.up=cross(camera.right,camera.forward);
  const pixels=new Uint8Array(width*height*3),depth=new Float64Array(width*height).fill(Infinity),light=unit(sun),shadowSize=1536;
  for(let y=0;y<height;y++){const t=y/height;for(let x=0;x<width;x++){const i=(y*width+x)*3;pixels[i]=90+90*t;pixels[i+1]=140+61*t;pixels[i+2]=188+30*t;}}
  const mats=new Map(meshes.map(m=>[m,material(m.name,textures)]));
  const bb=bounds(meshes),radius=Math.hypot(...sub(eye,target))<150?85:Math.max(...bb.max.map((x,i)=>x-bb.min[i]))*.65;
  const shadowView={...basis(light),eye:target,perspective:false,scale:shadowSize/(2*radius)};
  const shadow=new Float64Array(shadowSize*shadowSize).fill(-Infinity);
  if(shadows)raster(meshes,shadowView,shadowSize,shadowSize,(x,y,z,p,a,b,c,m)=>{
    const mat=mats.get(m);if(mat.alphaTest&&mat.texture){const s=textureSample(mat.texture,a*p[0][6]+b*p[1][6]+c*p[2][6],a*p[0][7]+b*p[1][7]+c*p[2][7]);if(s[3]<100)return;}
    const i=y*shadowSize+x;if(z>shadow[i])shadow[i]=z;
  });
  raster(meshes,camera,width,height,(x,y,z,p,a,b,c,m,uvRate)=>{
    const index=y*width+x;if(z>=depth[index])return;const mat=mats.get(m);
    const attr=k=>a*p[0][k]+b*p[1][k]+c*p[2][k];
    let sample=mat.texture?textureSample(mat.texture,attr(6),attr(7),uvRate*Math.max(mat.texture.width,mat.texture.height)):mat.color.map(v=>v*255).concat(255);
    // Exported terrain UVs address blend masks, not the tiled detail layers.
    // World tiling is an explicitly approximate substitute for Halo shader constants.
    if(mat.name==='hugegrass'&&mat.texture){sample=textureSample(mat.texture,attr(0)*.3,attr(1)*.3,z/camera.scale*.3*mat.texture.width).map((v,k)=>k===3?v:v*[.7,1,.48][k]);
      if(textures.hugegrass_mask&&textures.ground_humus){const mask=textureSample(textures.hugegrass_mask,attr(6),attr(7)),dirt=textureSample(textures.ground_humus,attr(0)*.3,attr(1)*.3,z/camera.scale*.3*textures.ground_humus.width),blend=mask[0]/255;sample=sample.map((v,k)=>k===3?255:v*(1-blend)+dirt[k]*blend);}
    }
    if(mat.name==='hugecliff'&&mat.texture){const axis=Math.abs(attr(3))>Math.abs(attr(4))?1:0;sample=textureSample(mat.texture,attr(axis)*.06,attr(2)*.06,z/camera.scale*.06*mat.texture.width);}
    if(mat.alphaTest&&sample[3]<100)return;
    const n=unit([attr(3),attr(4),attr(5)]),world=[attr(0),attr(1),attr(2)];
    let visibility=1;
    if(shadows){const d=sub(world,target),sx=shadowSize/2+dot(d,shadowView.right)*shadowView.scale,sy=shadowSize/2-dot(d,shadowView.up)*shadowView.scale,sz=dot(d,light),bias=Math.max(.04,radius/shadowSize*(2.5+3*(1-Math.abs(dot(n,light)))));let blocked=0,total=0;
      for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const ix=Math.round(sx)+xx,iy=Math.round(sy)+yy;if(ix>=0&&iy>=0&&ix<shadowSize&&iy<shadowSize){total++;if(shadow[iy*shadowSize+ix]>sz+bias)blocked++;}}
      if(total)visibility=1-blocked/total;
    }
    const diffuse=Math.max(0,dot(n,light))*visibility*sunStrength,hemi=ambient*(.62+.38*Math.max(0,n[2]));
    const haze=1-Math.exp(-Math.max(0,z-35)*fog),hazeColor=[.56,.68,.77];
    for(let k=0;k<3;k++) {const albedo=Math.pow(sample[k]/255,2.2),lit=albedo*(hemi*[.78,.88,1.06][k]+diffuse*[1,.94,.83][k])+mat.emission*albedo;const srgb=Math.pow(Math.max(0,lit),1/2.2);pixels[index*3+k]=Math.round(255*Math.min(1,srgb*(1-haze)+hazeColor[k]*haze));}
    depth[index]=z;
  });
  if(marker){
    const d=sub(marker,eye),z=dot(d,camera.forward);
    if(z>.1){const mx=width/2+dot(d,camera.right)*camera.scale/z,my=height/2-dot(d,camera.up)*camera.scale/z;
      for(let y=Math.max(0,Math.floor(my-20));y<Math.min(height,my+21);y++)for(let x=Math.max(0,Math.floor(mx-20));x<Math.min(width,mx+21);x++){
        const distance=Math.hypot(x-mx,y-my);let color=null;
        if(distance>=12&&distance<=18)color=[9,20,26];if(distance>=14&&distance<=16)color=[72,238,255];if(distance<=3)color=[72,238,255];
        if(color)for(let k=0;k<3;k++)pixels[(y*width+x)*3+k]=color[k];
      }
    }
  }
  return encodePng(width,height,pixels);
}
