import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { parseObj, renderObj } from '../src/preview.mjs';

test('OBJ accepts negative/slashed face indices and rejects broken geometry', () => {
  const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4/1 -3/2 -2/3 -1/4');
  assert.equal(mesh.triangles.length, 2);
  assert.throws(() => parseObj('v NaN 0 0'), /Invalid/);
  assert.throws(() => parseObj('v 0 0 0\nf 1 2 3'), /index/);
  assert.throws(() => parseObj('v 0 0 0'), /no triangle/);
});

test('CPU render produces a nonblank PNG; camera changes image', () => {
  const mesh = parseObj('v 0 0 0\nv 3 0 0\nv 0 2 0\nf 1 2 3');
  const png = renderObj(mesh, { width: 128, height: 96 });
  assert.equal(png.subarray(1,4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 96);
  const data = [];
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p);
    if (png.toString('ascii',p+4,p+8) === 'IDAT') data.push(png.subarray(p+8,p+8+n));
    p += n+12;
  }
  const raw = inflateSync(Buffer.concat(data));
  assert.equal(raw.length, 96*(128*3+1));
  let foreground = 0;
  for (let y=0;y<96;y++) for(let x=0;x<128;x++) if(raw[y*385+1+x*3] !== 20) foreground++;
  assert.ok(foreground > 500);
  assert.notDeepEqual(png,renderObj(mesh,{width:128,height:96,azimuth:45}));
  assert.throws(() => renderObj(mesh,{width:100000}), /dimensions/);
});
