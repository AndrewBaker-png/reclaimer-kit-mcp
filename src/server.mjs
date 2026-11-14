import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Projects, diff } from './projects.mjs';
import { assetPreview } from './preview.mjs';
import { scenePreview } from './scene-preview.mjs';
import { addVehicle, buildScenario } from './vehicle-workflow.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.env.RECLAIMER_MCP_CONFIG || path.join(base, 'config.local.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
for (const root of Object.values(config.roots)) if (!path.isAbsolute(root)) throw Error('All configured roots must be absolute.');
const projects = new Projects(config);
const server = new McpServer({ name: 'reclaimer-kit', version: '0.1.0' }, { instructions: 'Edits create separate format-2 scenario revisions. Read a project before editing and use its hash. Saved projects contain deltas, not the complete base-map object inventory. Rotation is radians. Scale 0 is an editor sentinel: preserve it unless explicitly changing scale. Load output files with File > Open Scenario from File in the Kit. Compile and playtest there before server deployment.' });
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const revision = { source: z.string(), name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/), expected_sha256: z.string().regex(/^[a-f0-9]{64}$/) };
function tool(name, description, inputSchema, readOnly, handler) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false } }, async args => {
    try { const result = await handler(args); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
tool('kit_status', 'Report configured project roots, editor availability and supported capabilities.', {}, true, async () => ({
  editor: config.editor, editorExists: await fs.access(config.editor).then(() => true, () => false),
  roots: config.roots, format: 2, transport: 'stdio',
  supported: ['list/read scenarios', 'copy with sidecars', 'transform previously captured placements', 'compare revisions', 'open editor by map name', 'verify compiled map', 'add vehicle from verified template', 'compile and inspect append-only vehicle edits', 'preview saved Pelican from compiled map'],
  preview: { tools: ['render_asset_preview', 'render_scene_preview'], method: 'Headless geometry/texture export and CPU PNG rendering', desktopCapture: false, scenarioEditsApplied: false, lockedSessionTested: false },
  limitations: ['No live scene API or automatic editor reload', 'Map inspection currently covers vehicle records only', 'Saved preview supports one added zero-rotation Pelican', 'Audio packaging may fail on malformed source banks; check packageComplete', 'Gameplay/server compatibility requires playtesting']
}));

server.registerTool('render_scene_preview', {
  description: 'Render Hugegrass terrain and a Pelican. By default reads the new Pelican placement from this revision’s compiled map, checking both hashes; compile_scenario must run first. Exactly one new zero-rotation Pelican supported. Other scenario objects are not rendered. placement_source=staged explicitly requests an unsaved demonstration. Returns PNG and provenance; uses no desktop/window/GPU. Lighting is approximate. Allow 180 seconds.',
  inputSchema: { id: z.string(), placement_source: z.enum(['saved','staged']).default('saved'), view: z.enum(['pelican','overview']).default('pelican'), sun_azimuth: z.number().min(-360).max(360).default(45), sun_elevation: z.number().min(5).max(85).default(65), shadows: z.boolean().default(true) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async args => {
  try { return await scenePreview(config, projects, args); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});

tool('add_vehicle_placement', 'Save a new scenario revision adding a vehicle using an existing base-map vehicle of the exact tag as template. Resolves its placement and palette from the map; preserves scale sentinel. Does not compile or deploy.', { ...revision, tag: z.string(), position: vector, rotation: vector.optional() }, false, args => addVehicle(projects,args));
tool('compile_scenario', 'Compile a saved revision in an isolated workspace profile, read back added vehicle records, and compare verifier errors with the base map. Saves latest-build.json for previews. Reports packageComplete=false if audio packaging fails even when the .map was written; never implies gameplay validation. Currently requires append-only vehicle edits. Allow 180 seconds.', { id: z.string(), expected_sha256: z.string().regex(/^[a-f0-9]{64}$/) }, false, args => buildScenario(config,projects,args));

server.registerTool('render_asset_preview', {
  description: 'Export a base-map render model or BSP and return a CPU-rendered PNG through MCP. Does not capture the desktop or apply scenario edits. Simple untextured geometry preview, not an in-game screenshot. Works without a window; locked-session operation not yet tested. Saves PNG, OBJ and provenance metadata under work/previews.',
  inputSchema: { id: z.string(), tag: z.string().min(1).max(240), group: z.enum(['mode','sbsp']).default('mode'), azimuth: z.number().min(-360).max(360).default(135), elevation: z.number().min(-89).max(89).default(25) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async args => {
  try { return await assetPreview(config, projects, args); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
tool('list_projects', 'List saved .rkscenario projects under configured roots; returns IDs usable by other tools.', {}, true, () => projects.list());
tool('read_project', 'Read a saved scenario and SHA-256. Edits are deltas, not a complete map inventory.', { id: z.string() }, true, ({ id }) => projects.read(id));
tool('list_placement_edits', 'List captured placement transforms, additions and deletions from a scenario.', { id: z.string() }, true, async ({ id }) => {
  const { sha256, scenario } = await projects.read(id);
  return { id, sha256, map: scenario.map, moved: scenario.changes.moved, added: scenario.changes.added, deleted: scenario.changes.deleted };
});
tool('copy_project', 'Create a new scenario revision with sidecar assets. Never overwrites an existing revision.', revision, false, a => projects.writeRevision(a.source, a.name, a.expected_sha256));
tool('set_placement_transform', 'Create a revision changing one captured placement. Position is absolute world units; rotation is yaw/pitch/roll in radians. Omitted fields stay unchanged. Select and move an uncaptured placement in the editor first, then save.', { ...revision, kind: z.string(), index: z.number().int().nonnegative(), position: vector.optional(), rotation: vector.optional(), scale: z.number().finite().nonnegative().optional() }, false, a => projects.transform(a));
tool('compare_projects', 'Compare scenario JSON values, including placements and unknown preserved fields.', { before: z.string(), after: z.string() }, true, async a => {
  const [before, after] = await Promise.all([projects.read(a.before), projects.read(a.after)]);
  return { before: before.sha256, after: after.sha256, changes: diff(before.scenario, after.scenario) };
});
tool('get_open_instructions', 'Return the absolute scenario file and exact editor workflow to load, save and compile it.', { id: z.string() }, true, async ({ id }) => ({ file: await projects.resolve(id), steps: ['In Reclaimer Kit choose File > Open Scenario from File.', 'Enter the file path and open it. Save current editor work first.', 'Inspect the changed placement values.', 'Use File > Compile Map for a playable package; playtest before deploying.'] }));
tool('open_editor', 'Launch a new Reclaimer Kit window, optionally on an installed map by title/file name. Does not load scenario edits. Use only when an additional editor instance is wanted.', { map: z.string().regex(/^[a-zA-Z0-9 _.-]{1,100}$/).optional() }, false, async ({ map }) => {
  const child = spawn(config.editor, map ? ['--map', map] : [], { cwd: path.dirname(config.editor), detached: true, stdio: 'ignore', windowsHide: false, shell: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref(); return { pid: child.pid, map: map ?? null, status: 'launched; map loading is not yet verified' };
});
tool('verify_map', 'Run the Kit headless verifier on a compiled .map inside an allowed map root. This checks structure, not multiplayer gameplay.', { file: z.string() }, true, async ({ file }) => {
  const target = await fs.realpath(file);
  if (path.extname(target).toLowerCase() !== '.map') throw Error('Expected a compiled .map file.');
  let allowed = false;
  for (const root of config.mapRoots ?? []) {
    const real = await fs.realpath(root).catch(() => null);
    if (!real) continue;
    const rel = path.relative(real, target);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) allowed = true;
  }
  if (!allowed) throw Error('Map is outside configured map roots.');
  try {
    const r = await promisify(execFile)(config.editor, ['--verify-map', target], { timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, cwd: path.dirname(config.editor) });
    return { exitCode: 0, stdout: r.stdout, stderr: r.stderr, gameplayTested: false };
  } catch (e) { return { exitCode: e.code ?? null, timedOut: !!e.killed, stdout: e.stdout ?? '', stderr: e.stderr ?? '', error: e.message, gameplayTested: false }; }
});
await server.connect(new StdioServerTransport());
