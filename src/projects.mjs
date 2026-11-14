import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_BYTES = 16 * 1024 * 1024;
export const hash = text => createHash('sha256').update(text).digest('hex');
const inside = (root, target) => { const r = path.relative(root, target); return r === '' || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); };
export function validateScenario(s) {
  if (!s || s.format !== 2 || typeof s.map?.file !== 'string' || !Number.isInteger(s.map.id) || !s.changes || !Array.isArray(s.changes.moved)) throw Error('Expected a Reclaimer format-2 scenario with map and changes.moved.');
  const seen = new Set();
  for (const m of s.changes.moved) {
    if (typeof m.kind !== 'string' || !Number.isInteger(m.index) || m.index < 0) throw Error('Invalid placement identity.');
    const key = `${m.kind}:${m.index}`;
    if (seen.has(key)) throw Error(`Duplicate placement: ${key}`);
    seen.add(key);
    validateTransform(m.transform);
  }
  return s;
}
export function validateTransform(t) {
  for (const key of ['position', 'rotation']) if (!Array.isArray(t?.[key]) || t[key].length !== 3 || !t[key].every(Number.isFinite)) throw Error(`${key} must contain three finite numbers.`);
  if (!Number.isFinite(t.scale) || t.scale < 0) throw Error('scale must be nonnegative; preserve 0 as the editor default sentinel.');
}
export function diff(a, b, prefix = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diff(a[k], b[k], `${prefix}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`));
  }
  return [{ path: prefix || '/', before: a ?? null, after: b ?? null }];
}

export class Projects {
  constructor(config) { this.config = config; }
  async resolve(id) {
    const split = id.indexOf(':');
    const alias = id.slice(0, split), relative = id.slice(split + 1);
    if (split < 1 || !Object.hasOwn(this.config.roots, alias) || !relative || relative.includes(':') || path.isAbsolute(relative)) throw Error('Use a project ID returned by list_projects (root:relative/path.rkscenario).');
    const root = await fs.realpath(this.config.roots[alias]);
    const target = await fs.realpath(path.resolve(root, relative));
    if (!inside(root, target) || path.extname(target) !== '.rkscenario') throw Error('Project must remain within an allowed root and end in .rkscenario.');
    return target;
  }
  async read(id) {
    const file = await this.resolve(id);
    if ((await fs.stat(file)).size > MAX_BYTES) throw Error('Scenario exceeds 16 MiB limit.');
    const raw = await fs.readFile(file);
    const scenario = validateScenario(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    return { id, sha256: hash(raw), scenario };
  }
  async list() {
    const projects = [], unavailableRoots = [];
    for (const [alias, root] of Object.entries(this.config.roots)) {
      try {
        const walk = async (dir, depth = 0) => {
          if (depth > 8) return;
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(file, depth + 1);
            else if (entry.isFile() && entry.name.endsWith('.rkscenario')) projects.push(`${alias}:${path.relative(root, file).split(path.sep).join('/')}`);
            if (projects.length > 2000) throw Error('Project listing exceeds 2000 entries.');
          }
        };
        await walk(root);
      } catch (e) { unavailableRoots.push({ alias, error: e.message }); }
    }
    return { projects: projects.sort(), unavailableRoots };
  }
  async writeRevision(source, name, expectedHash, update = () => {}) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw Error('Revision name must be 1–80 letters, digits, underscores or hyphens.');
    const current = await this.read(source);
    if (current.sha256 !== expectedHash) throw Error('Source changed. Read the project again before editing.');
    const next = structuredClone(current.scenario);
    update(next);
    validateScenario(next);
    // Preserve sidecar assets by requiring them to remain at the original project location.
    // Copy the entire project directory into a new revision directory, then replace only the scenario.
    const sourceFile = await this.resolve(source);
    const sourceDir = path.dirname(sourceFile);
    const outRoot = path.resolve(this.config.roots.work);
    await fs.mkdir(outRoot, { recursive: true });
    const realOut = await fs.realpath(outRoot);
    const destDir = path.join(realOut, name);
    if (inside(sourceDir, destDir)) throw Error('Output directory cannot be inside the source project directory.');
    // Refuse links anywhere in the sidecar tree; never follow them outside a project.
    let bytes = 0;
    const inspect = async dir => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink()) throw Error('Project sidecars contain a symbolic link.');
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await inspect(p);
        else if (!e.name.endsWith('.rkscenario')) { bytes += (await fs.stat(p)).size; if (bytes > 512 * 1024 * 1024) throw Error('Sidecars exceed 512 MiB.'); }
      }
    };
    await inspect(sourceDir);
    await fs.mkdir(destDir); // Exclusive: never overwrite an existing revision.
    try {
      for (const e of await fs.readdir(sourceDir, { withFileTypes: true })) {
        if (e.name.endsWith('.rkscenario')) continue;
        await fs.cp(path.join(sourceDir, e.name), path.join(destDir, e.name), { recursive: true, errorOnExist: true, force: false });
      }
      const raw = JSON.stringify(next, null, 2) + '\n';
      const file = path.join(destDir, `${name}.rkscenario`);
      await fs.writeFile(file, raw, { flag: 'wx' });
      return { id: `work:${name}/${name}.rkscenario`, file, sha256: hash(raw), changes: diff(current.scenario, next), sidecarBytes: bytes };
    } catch (e) { throw Error(`Revision incomplete at ${destDir}; source is unchanged. ${e.message}`); }
  }
  async transform(args) {
    if (!args.position && !args.rotation && args.scale === undefined) throw Error('Provide position, rotation or scale.');
    return this.writeRevision(args.source, args.name, args.expected_sha256, next => {
      const placement = next.changes.moved.find(m => m.kind === args.kind && m.index === args.index);
      if (!placement) throw Error('Placement is not in saved edits. Move it once in the editor and save to capture its full transform first.');
      if (args.position) placement.transform.position = args.position;
      if (args.rotation) placement.transform.rotation = args.rotation;
      if (args.scale !== undefined) placement.transform.scale = args.scale;
    });
  }
}
