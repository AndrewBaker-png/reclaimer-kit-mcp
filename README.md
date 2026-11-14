# Reclaimer Kit MCP

Local stdio MCP server for the Project Reclaimer Editing Kit. Requires Node 22+.
Uses the official MCP SDK 1.x compatibility line (pinned, lockfile included).

Independent community integration; not an official Project Reclaimer or Halo
release. Requires your own installed Reclaimer Kit and legally obtained game
and mod content. This repository contains code only, with no game assets,
compiled maps, editor executable, or machine-local configuration.

## Run

```powershell
git clone https://github.com/AndrewBaker-png/reclaimer-kit-mcp.git
cd reclaimer-kit-mcp
npm.cmd ci
Copy-Item config.example.json config.local.json
npm.cmd test
npm.cmd start
```

Edit absolute paths in `config.local.json` for another installation. The local
configuration and generated `projects/` directory are ignored by Git. Set
`RECLAIMER_MCP_CONFIG` to use a different configuration file. The server uses
stdio and is launched by the MCP client; it does not need a network port.

Client configuration (replace the absolute path for another checkout):

```json
{
  "mcpServers": {
    "reclaimer-kit": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/Projects/reclaimer-kit-mcp/src/server.mjs"]
    }
  }
}
```

For Codex, register your installation as `reclaimer-kit` using
`codex mcp add`. Check it with `codex mcp get reclaimer-kit`. A chat must load
the server's tools before they can be called directly.

Diagnostics from this directory:

```powershell
node scripts/call.mjs kit_status
node scripts/call.mjs list_projects
```

Pass a JSON argument file as the third argument to call other tools. The
optional `node scripts/smoke-hugegrass.mjs` test uses the saved Hugegrass
baseline from the development machine (not included) and creates a new test revision each run; its latest report is
`projects/smoke-result.json`.

The Hugegrass preview/save/smoke scripts are development examples with specific
project IDs. Adapt those IDs to your own saved projects before running them.
The automated `npm test` suite uses synthetic fixtures and needs no game files.
Hugegrass is by [RejectedShotgun](https://steamcommunity.com/sharedfiles/filedetails/?id=2984061723);
the original mod and its assets are not bundled here.

## Tools and workflow

### Saved vehicle → compiled map → preview

The placement loop is now implemented for append-only vehicle additions:

1. `read_project` returns the source hash.
2. `add_vehicle_placement` takes `source`, `name`, `expected_sha256`, exact
   vehicle `tag`, `position` and optional `rotation`. It reads the base map's
   vehicle table/palette and clones an existing vehicle of that tag. Nothing
   is inferred from a report row number. The map is never modified in place.
3. `compile_scenario` takes `id` and `expected_sha256`. It runs the installed
   Kit in an isolated profile under `projects/builds`, reads back the vehicle
   records and checks them against the saved additions, verifies existing
   vehicle rows stayed byte-identical, and compares verifier errors to the base.
   It retains exact source audio sidecars and reports compiler/verification
   failures honestly. `packageComplete: false` is not a deployable package.
4. `render_scene_preview` defaults to `placement_source: "saved"`. It requires
   a matching `latest-build.json`, checks the compiled file hash, exports fresh
   geometry/textures from that file and reads the new Pelican's transform from
   its vehicle table. A stale/missing build fails rather than staging a model.
   The initial scope is exactly one new zero-rotation Pelican, plus the BSPs;
   other scenario objects are not rendered. `view: "overview"` adds a cyan
   position marker. Use `placement_source: "staged"` only for a demonstration.

Actual Hugegrass test (2026-11-14):

- Saved revision: `work:hugegrass_pelican_saved_20261114/hugegrass_pelican_saved_20261114.rkscenario`.
- Vehicle count 123 → 124; new vehicle 123 resolves to
  `objects\\vehicles\\pelican_multiplayer\\pelican_multiplayer` at
  `[0, 250, 122.72416687011719]` in the compiled file (float32 rounding).
- All original vehicle records and the original map hash remained unchanged.
- Compiler wrote the map, then failed on the existing Lich bank's 3-entry
  index versus its 1-sound FSB. After copying original audio sidecars without
  alterations, both original and output verifier report the same 62 sound
  errors and no new diagnostics. No clean package/gameplay claim is made.
- `node scripts/preview-saved.mjs` regenerates the close-up over MCP;
  append `overview` for the marked map view. It verifies the returned PNG
  equals the saved artifact. No editor window or desktop capture is used.

`latest-build.json` and the build directory retain source/output hashes,
compiler logs, verifier logs and the read-back records. The map inspector is
read-only and scoped to the MCC Halo 3 v13 layout. Layout references:
[CacheFileU6](https://github.com/Gravemind2401/Reclaimer/blob/master/Reclaimer.Blam/Blam/MccHalo3/CacheFileU6.cs),
[CacheFile](https://github.com/Gravemind2401/Reclaimer/blob/master/Reclaimer.Blam/Blam/MccHalo3/CacheFile.cs),
[TagAddressTranslator](https://github.com/Gravemind2401/Reclaimer/blob/master/Reclaimer.Blam/Blam/Common/Gen3/TagAddressTranslator.cs),
and the installed Kit's embedded vehicle schema/deserialization checks.

### Earlier transform workflow

1. `kit_status`, `list_projects`, `read_project`, `list_placement_edits`: inspect
   projects. IDs look like `kit:hugegrass_mcp_baseline/hugegrass_mcp_baseline.rkscenario`.
2. `copy_project`: create a named copy, including sidecar assets.
3. `set_placement_transform`: write a new revision with absolute position,
   yaw/pitch/roll in radians, and/or scale. Pass the source SHA-256 returned by
   `read_project`. Unknown fields are preserved. Existing revisions are never
   overwritten. Scale zero is preserved as the Kit's default sentinel.
4. `compare_projects` and `get_open_instructions`: review the diff and load the
   resulting file through File > Open Scenario from File in the Kit.
5. Compile through the Kit UI (or `compile_scenario` within its scope), then `verify_map` can invoke the documented
   headless verifier on a compiled map within configured map roots.
6. Playtest the package before deploying to a server.

`open_editor` starts an additional editor process, optionally on a base map.
It does not attach to an existing instance or open a scenario file.

## Scope and limitations

### Preview images without desktop capture

`render_scene_preview` now renders a composed Hugegrass scene: all nine BSP
sections and their exported instances (buildings, trees and rocks), a Pelican
with damaged engine alternatives excluded, exported map textures, directional
sunlight, sky fill, filtered cast shadows, alpha-cutout foliage, perspective,
distance haze and texture mipmaps. Everything runs on the CPU without a window
or GPU. Select `view: "pelican"` or `view: "overview"`; `sun_azimuth`,
`sun_elevation` and `shadows` control preview lighting. The first run caches
exports and can take longer; use a 180-second MCP request timeout.

```json
{
  "id": "work:hugegrass_bridge_1794640723071/hugegrass_bridge_1794640723071.rkscenario",
  "view": "pelican",
  "placement_source": "staged",
  "sun_azimuth": 45,
  "sun_elevation": 65,
  "shadows": true
}
```

This staged example supports `hugeass_remastered_mcc.map`. The Pelican is **staged for
the image only**, grounded using the terrain triangles; no scenario placement
is saved. It is not a collision/clearance or gameplay test. Scenario deltas and
other scenario objects (vehicles, weapons and separately placed scenery) are
not reconstructed. BSP instances are included.

The GLB exporter supplies geometry, hierarchy, UVs, normals and material names,
but no Halo shader graph or lightmap associations. The explicit texture palette
therefore uses approximate material associations, terrain layer tiling/tint,
and fallback colors. Terrain control masks are used as blend data rather than
displayed as colors. Preview sunlight, ambient sky and shadows replace the
original lighting; baked lightmaps, reflection probes, water and particles
remain unsupported. These differences are recorded in every `preview.json`.

Each scene has a PNG and metadata with source scenario hash, export hashes,
camera, lighting, preview-only Pelican transform, missing texture warnings and
fallback materials. Export cache keys include map path, size/mtime and editor
path, size/mtime. No network service, editor UI automation or GPU is required.
An actual Windows locked-session test remains outstanding; this does not wake
a sleeping computer or start an MCP server after logout.

Validation: `npm test` covers GLB transforms, PNG decoding/encoding, terrain
height, texture and sunlight changes, cast shadows and MCP discovery.
`node scripts/smoke-scene.mjs overview` performs an actual render over MCP,
checks the returned PNG against the file/hash and confirms the scenario stayed
unchanged. `node scripts/preview-scene.mjs pelican` runs the renderer directly
with progress output. Reconnect an existing MCP client to discover the new tool.

`render_asset_preview` exports real base-map geometry using Kit v0.10.3's
`--kit-tool export`, rasterizes it entirely on the CPU, and returns a PNG image
content block through MCP. It opens no window and uses no desktop capture or
GPU. An actual Windows locked-session test remains outstanding; the machine
must remain awake and the MCP process must still be running.

Example arguments:

```json
{
  "id": "work:hugegrass_bridge_1794640723071/hugegrass_bridge_1794640723071.rkscenario",
  "tag": "objects\\vehicles\\pelican_multiplayer\\pelican_multiplayer",
  "group": "mode",
  "azimuth": 135,
  "elevation": 25
}
```

Use `mode` for a render model or `sbsp` for level geometry. The tag path must
come from the map's tag report; it is not an object display name. Each call
creates a fresh directory under `projects/previews` with the exported OBJ,
`preview.png`, and `preview.json`. Metadata includes scenario, mesh and PNG
hashes, the camera, source-map size/mtime, and explicit limitations. The
scenario hash identifies the source project, **not applied edits**.

This first renderer shows raw exported geometry with simple shading. It does
not apply scenario placements, materials, animation, model permutations, or
game lighting. Exported parts/LODs can overlap. It is not a game screenshot or
proof of a placed Pelican. Use `render_scene_preview` for the composed Hugegrass
preview described above. Automatic reconstruction of scenario edits remains
future work.

`node scripts/preview-pelican.mjs` exercises the actual export and MCP response
and verifies the returned image equals the saved PNG. The tool is available
to newly started server processes; existing clients need to reconnect/reload
the server to discover it. No editor session is manipulated.

The installed executable's `--help` and `--kit-tool help` also expose headless
compile/export/report commands omitted from the web reference at the time of
implementation. These are separate from `--headless`, which uses a null
renderer and cannot produce a game image.

The scenario is a **delta** against a base map. `set_placement_transform` edits
placement transforms already captured in `changes.moved`. For another object,
move it once in the Kit and save to capture its identity and full transform.
The bridge refuses to invent base-map indexes, tag offsets or missing fields.
Vehicle additions and scoped compilation are implemented as described above.
General object removal, tag/script edits and a complete scene inventory are not
implemented. There is no live scene query or UI automation dependency.

Sidecars beside a source scenario are copied into each revision (up to 512 MiB).
Keep each source project in its own directory. Symlinks are refused. External
absolute asset references are preserved, not bundled or rewritten. Revision
output must be outside the source project directory. Interrupted copies are
reported as incomplete and must be inspected; no source data is removed.

The Hugegrass format-2 proof changed weapon index 1 (Stanchion) Y from 2.5 to
12.5, reopened it in Kit v0.10.3, and saved the same value back. The original
Workshop map's SHA-256 was unchanged. This verifies placement editing, not all
scenario fields or server compatibility. Development evidence and exported game
assets are retained locally and are not included in this repository.

References: [Kit reference](https://projectreclaimer.dev/kit-reference),
[official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
