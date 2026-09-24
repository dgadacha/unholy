<p align="center">
  <b>Unholy</b> — a game built on a browser engine written from scratch.
</p>

---

## Where this stands

The game does not exist yet. What exists is the engine it will be built on,
brought over whole from the rendering work that preceded it: it loads a level,
lights it, runs a player and seven opponents in it at 125 Hz, and draws the
result with a modern pipeline. Everything in `src/` runs today.

What it can do, briefly:

- **Levels.** BSP v46 geometry, lightmaps, the light grid, curved patches,
  visibility, movers, triggers, and the `.shader` scripts that say how each
  surface is drawn. Archives are read over HTTP range requests, so a level is
  mounted without downloading everything.
- **Rendering.** Deferred-ish chain over Three.js: dynamic lights and shadows
  on top of the baked lighting, reflection probes, ambient occlusion, bloom,
  colour grading per level, dynamic internal resolution, and nine debug
  channels to look at any single term.
- **Materials.** An offline Python chain rebuilds textures in high definition
  from the originals — learned upscaling where it holds up, normal, roughness,
  metal and occlusion maps derived from the colour, validation against the
  source, and optional GPU compression.
- **Play.** Original 125 Hz movement, the nine weapons with their own damage,
  splash and knockback, items and respawn timers, a Free For All match against
  bots that navigate the level with its own navigation data, player models with
  their animations and held weapons, gibs, obituaries, a scoreboard.
- **Tools.** A real benchmark on a camera path built from the level itself, a
  material comparison mode, in-page screenshots written to `docs/`, and a
  settings panel with sixty knobs for putting the image right.

**Game data is never in this repository.** The levels, textures, models and
sounds are read at runtime from a Quake III Arena installation on your own
machine, linked into `public/data`; the high definition materials derived from
them are written to a folder that git ignores. Clone this and you get code.

---

## Requirements

- Node 20 or newer, a browser with WebGL 2.
- A Quake III Arena installation, for as long as the game uses its data.
- Python 3.11 with numpy and Pillow, for the texture chain only.

---

## Getting started

```bash
npm install
```

Link your game data, then start the dev server:

```bash
ln -s "/path/to/Quake III Arena/baseq3" public/data/baseq3
```

```bash
npm run dev
```

The server listens on port 5214. URL parameters: `?play` starts the level
immediately, `?map=<name>` picks another one, `?mute` silences the sound,
`?source=<folder>` chooses which data folder to mount.

---

## Layout

```
src/
  audio/        sound playback, decoding, master volume
  formats/      pk3, bsp, md3, aas, shader scripts, binary reading
  bsp/          geometry, lightmaps, light grid, visibility, curved patches
  game/         session, player movement, collision, weapons, entities
                match/      fighters, damage, match rules, player models
                bots/       navigation over the level's areas, behaviour
                benchmark/  camera path and measurement
  renderer/     pipeline, settings, lighting, materials, grading, post
  ui/           menu, HUD, settings, benchmark screens
tools/
  texture-pipeline/     the offline chain, Python, numpy and Pillow only
  materials.test.ts     material and shader script tests
  movement.test.ts      step climbing test
  weapons.test.ts       weapon frames and rail behaviour
  render-smoke.html     rendering smoke test
  profile.html          per-pass profiling
public/
  data/         your archives, or links to them, never in git
  generated/    materials produced by the chain, never in git
docs/           screenshots written by the capture tools
```

---

## Tests and checks

```bash
npm run check   # TypeScript, no emit
npm test        # materials, shader scripts, light grid, lava, movement, weapons
npm run build   # type check then production build
```

```bash
python3 tools/texture-pipeline/test_pipeline.py
```

Each test exists because something was broken and stayed broken for a while.
The movement one walks a flight of sixteen unit steps: the slide move used to
report "not blocked" as soon as one of its bumps ended in the clear, so step
climbing was never attempted and the player stood in front of every staircase.

---

## Credits

**Quake III Arena** is the work of id Software, 1999. Its data is read from
your own installation and never leaves your machine. Everything here — engine,
renderer, material chain, game code — is written from scratch.
