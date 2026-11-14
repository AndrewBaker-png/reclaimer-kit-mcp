import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { hash } from './projects.mjs';

// Deliberately independent of Windows, a GPU, a window, and desktop capture.
export function parseObj(text) {
  const vertices = [], triangles = [];
  for (const line of text.split(/\r?\n/)) {
    const [kind, ...fields] = line.trim().split(/\s+/);
    if (kind === 'v') {
      const v = fields.slice(0, 3).map(Number);
      if (v.length !== 3 || !v.every(Number.isFinite)) throw Error('Invalid OBJ vertex.');
      vertices.push(v);
    } else if (kind === 'f') {
      const face = fields.map(f => {
        const n = Number(f.split('/')[0]);
        const index = n < 0 ? vertices.length + n : n - 1;
        if (!Number.isInteger(n) || !vertices[index]) throw Error('Invalid OBJ face index.');
        return index;
      });
      for (let i = 1; i + 1 < face.length; i++) triangles.push([face[0], face[i], face[i + 1]]);
    }
    if (vertices.length > 1000000 || triangles.length > 1000000) throw Error('Preview mesh is too large.');
  }
  if (!vertices.length || !triangles.length) throw Error('Export has no triangle geometry.');
  return { vertices, triangles };
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normal = a => { const n = Math.hypot(...a); return a.map(x => x / (n || 1)); };

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

export function renderObj(mesh, { width = 960, height = 720, azimuth = 135, elevation = 25 } = {}) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 64 && n <= 1600)) throw Error('Invalid image dimensions.');
  if (![azimuth, elevation].every(Number.isFinite)) throw Error('Invalid camera.');
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  const forward = [Math.cos(a)*Math.cos(e), Math.sin(a)*Math.cos(e), Math.sin(e)];
  const right = [-Math.sin(a), Math.cos(a), 0], up = cross(forward, right);
  const points = mesh.vertices.map(v => [dot(v, right), dot(v, up), dot(v, forward)]);
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 2; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  const scale = .84 * Math.min(width / (max[0]-min[0] || 1), height / (max[1]-min[1] || 1));
  const projected = points.map(p => [(p[0]-(min[0]+max[0])/2)*scale+width/2, height/2-(p[1]-(min[1]+max[1])/2)*scale, p[2]]);
  const pixels = Buffer.alloc(width*height*3), depth = new Float64Array(width*height).fill(-Infinity);
  for (let i = 0; i < width*height; i++) { pixels[i*3]=20; pixels[i*3+1]=28; pixels[i*3+2]=39; }
  const edge = (p, q, x, y) => (q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);
  const light = normal([-.5, -.6, 1]);
  for (const tri of mesh.triangles) {
    const [p, q, r] = tri.map(i => projected[i]);
    const area = edge(p,q,r[0],r[1]);
    if (Math.abs(area) < 1e-8) continue;
    let n = normal(cross(sub(mesh.vertices[tri[1]],mesh.vertices[tri[0]]),sub(mesh.vertices[tri[2]],mesh.vertices[tri[0]])));
    if (dot(n, forward) < 0) n = n.map(x => -x);
    const shade = .3 + .7 * Math.max(0, dot(n, light));
    const color = [164, 181, 153].map(c => Math.round(c*shade));
    const x0=Math.max(0,Math.floor(Math.min(p[0],q[0],r[0]))), x1=Math.min(width-1,Math.ceil(Math.max(p[0],q[0],r[0])));
    const y0=Math.max(0,Math.floor(Math.min(p[1],q[1],r[1]))), y1=Math.min(height-1,Math.ceil(Math.max(p[1],q[1],r[1])));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const u=edge(q,r,x+.5,y+.5)/area, v=edge(r,p,x+.5,y+.5)/area, w=1-u-v;
      if(u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
      const z=u*p[2]+v*q[2]+w*r[2], index=y*width+x;
      if(z<=depth[index]) continue;
      depth[index]=z; for(let c=0;c<3;c++) pixels[index*3+c]=color[c];
    }
  }
  const rows=Buffer.alloc(height*(width*3+1));
  for(let y=0;y<height;y++) pixels.copy(rows,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
  const header=Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

export async function assetPreview(config, projects, { id, tag, group = 'mode', azimuth = 135, elevation = 25 }) {
  const segments = tag.split(/[\\/]/);
  if (!segments.length || segments.some(s => !/^[a-zA-Z0-9_ .-]+$/.test(s) || s === '.' || s === '..')) throw Error('Invalid tag path.');
  if (!['mode','sbsp'].includes(group)) throw Error('Only render models and level geometry are supported.');
  const source = await projects.read(id);
  const map = await fs.realpath(source.scenario.map.file);
  if (path.extname(map).toLowerCase() !== '.map') throw Error('Scenario does not reference a map.');
  const mapStat = await fs.stat(map);
  const root = path.join(config.roots.work, 'previews');
  await fs.mkdir(root, { recursive: true });
  const output = await fs.mkdtemp(path.join(root, 'asset-'));
  await promisify(execFile)(config.editor, ['--kit-tool','export','--map',map,'--tag',segments.join('\\'),'--group',group,'--format','obj','--out',output], { timeout: 120000, maxBuffer: 2*1024*1024, windowsHide: true, cwd: path.dirname(config.editor) });
  const obj = path.join(output, ...segments) + '.obj';
  if ((await fs.stat(obj)).size > 64*1024*1024) throw Error('Export exceeds preview size limit.');
  const raw = await fs.readFile(obj);
  const mesh = parseObj(raw.toString('utf8'));
  const png = renderObj(mesh, { azimuth, elevation });
  const file = path.join(output, 'preview.png');
  const metadata = { type: 'asset-geometry-preview', file, project: id, scenarioSha256: source.sha256, map, mapSize: mapStat.size, mapMtime: mapStat.mtime.toISOString(), tag, group, meshSha256: hash(raw), imageSha256: hash(png), triangles: mesh.triangles.length, camera: { azimuth, elevation }, created: new Date().toISOString(), desktopCapture: false, scenarioEditsApplied: false, limitations: 'Base-map geometry only, simple shading. No textures, game lighting, animation, placement edits or collision validation. Not an editor screenshot. Locked-session behavior has not been tested.' };
  await fs.writeFile(file, png, { flag: 'wx' });
  await fs.writeFile(path.join(output, 'preview.json'), JSON.stringify(metadata,null,2), { flag: 'wx' });
  return { content: [{ type:'text', text:JSON.stringify(metadata,null,2) }, { type:'image', mimeType:'image/png', data:png.toString('base64') }] };
}
