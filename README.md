# LUMIR Audio Console V2

Checkpoint 1C visual shell. This is an isolated, dependency-free browser application designed for a 16:9 desktop-first console.

## Run

```powershell
npm.cmd start
```

Open `http://127.0.0.1:4173`.

## Architecture

- `src/audio`: future Web Audio graph and unified analysis frame.
- `src/centers`: swappable center-visual registry and a Canvas 2D surface adapter; eight target IDs are reserved. The adapter contract keeps a future WebGL renderer independent from the UI shell.
- `src/lighting`: future ambient and activity-light model.
- `src/playlist`: future queue and media-source handling.
- `src/presets`: future visual-state presets.
- `src/state`: framework-neutral application state.
- `src/ui`: console rendering surfaces and tokens.
- `src/utils`, `src/visuals`, `assets`: reserved for shared helpers, visual primitives and local assets.

The visible console shell is static. No audio analysis, playback, playlists, presets, activity animation or Cosmic Core is implemented. The physical shell raster asset is deliberately separate from the Canvas-ready visual-core surface.
