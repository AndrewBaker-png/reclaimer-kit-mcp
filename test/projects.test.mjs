import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../src/projects.mjs';

export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reclaimer-mcp-'));
  const sourceDir = path.join(root, 'kit', 'sample');
  await fs.mkdir(path.join(sourceDir, 'images'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'images', 'sample.optional'), 'test-sidecar');
  const scenario = { format: 2, map: { file: 'base.map', id: 7521, title: 'Test' }, changes: { moved: [{ kind: 'weapon', index: 1, transform: { position: [-556.14246, 2.5, 230.03079], rotation: [-1.5746794, -0.02200387, 0.10626444], scale: 0 } }], added: [], deleted: [], future_field: { preserve: true } }, world: { unknown: [1, 2, 3] } };
  await fs.writeFile(path.join(sourceDir, 'sample.rkscenario'), JSON.stringify(scenario));
  const config = { roots: { kit: path.join(root, 'kit'), work: path.join(root, 'work') }, editor: 'missing-editor.exe', mapRoots: [] };
  return { root, config, projects: new Projects(config), id: 'kit:sample/sample.rkscenario' };
}
test('placement revision preserves source, unknown fields and sidecars', async t => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const before = await f.projects.read(f.id);
  const result = await f.projects.transform({ source: f.id, name: 'moved', expected_sha256: before.sha256, kind: 'weapon', index: 1, position: [-556.14246, 12.5, 230.03079] });
  assert.deepEqual(result.changes, [{ path: '/changes/moved/0/transform/position/1', before: 2.5, after: 12.5 }]);
  const after = await f.projects.read(result.id);
  assert.equal(after.scenario.changes.moved[0].transform.scale, 0);
  assert.deepEqual(after.scenario.world, before.scenario.world);
  assert.equal((await f.projects.read(f.id)).sha256, before.sha256);
  assert.equal(await fs.readFile(path.join(f.root, 'work', 'moved', 'images', 'sample.optional'), 'utf8'), 'test-sidecar');
  await assert.rejects(f.projects.writeRevision(f.id, 'moved', before.sha256), /EEXIST/);
});
test('refuses stale hash, unknown placement, invalid numbers and escaped IDs', async t => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const before = await f.projects.read(f.id);
  await assert.rejects(f.projects.writeRevision(f.id, 'stale', '0'.repeat(64)), /Source changed/);
  await assert.rejects(f.projects.writeRevision(f.id, '../escape', before.sha256), /Revision name/);
  await assert.rejects(f.projects.read('kit:../kit/sample/../../../outside.rkscenario'));
  const a = { source: f.id, name: 'bad', expected_sha256: before.sha256, kind: 'weapon', index: 99, position: [1, 2, 3] };
  await assert.rejects(f.projects.transform(a), /not in saved edits/);
  await assert.rejects(f.projects.transform({ ...a, index: 1, position: [1, NaN, 3] }), /finite/);
  assert.equal((await f.projects.read(f.id)).sha256, before.sha256);
});
test('refuses a real existing file outside configured roots', async t => {
  const f = await fixture(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.copyFile(path.join(f.config.roots.kit, 'sample', 'sample.rkscenario'), path.join(f.root, 'outside.rkscenario'));
  await assert.rejects(f.projects.read('kit:../outside.rkscenario'), /allowed root/);
});
