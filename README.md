# Tulip Hollow (Three.js + Rapier)

A small 3D free-roam game that begins in **The Dark Forest**. Explore as Raven with Snowball's
warm lantern glow, find the sparkling Forest Key, and unlock the Garden Gate. A golden-light gate
animation fades into the existing **Tulip Garden**, where you can wander through a little cottage,
pick tulips, feed the hopping bunnies, and chat with Beast Boy. The relaxed exploration is not timed.

Beside the cottage is a big autumn tree with a wooden swing. Enter the solid-walled cottage through
its doorway to find a candlelit birthday cake and letter on the table; press E (or use ACT/Y) to read
the letter in a pausing popup, then close it to resume exploring.

Walkways through the garden stay clear. The flower beds hold about 3,600 supplied tulips on desktop
and a lighter 1,400-bloom layout on touch devices. One hundred forty-four larger yellow five-point
stars fill the garden's night sky, with a denser star field in the Dark Forest as well.

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # typecheck + production build + JS/font budgets + total-size report
pnpm test     # unit tests (rules, save, i18n, garden layout, forest and letter quests)
pnpm smoke    # after build: headless browser playthrough + screenshots in shots/
```

## Netlify deployment

The repository includes `netlify.toml` and uses a storage-independent build. In Netlify, import
the GitHub repository and use the detected settings (or set `pnpm run build` as the build command
and `dist` as the publish directory). The GLB files under `assets/models/` and `assets/Raven Movements/`
must be committed to GitHub; the Manus storage restore script is not required for Netlify.

## Layout

| Path | Role | Change it? |
| --- | --- | --- |
| `src/engine/loop.ts` | Fixed 60 Hz simulation + interpolated rendering | Rarely |
| `src/engine/input.ts` | Keyboard/mouse, gamepad, touch → one action state | Add actions here |
| `src/engine/physics.ts` | Rapier world, collider helpers, render interpolation | Rarely |
| `src/engine/renderer.ts` | WebGL renderer, quality presets, bloom | Rarely |
| `src/engine/audio.ts` | Music/SFX buses, synthesized SFX, `load()` for files | Add sounds |
| `src/engine/save.ts` | Versioned localStorage save + leaderboard | Add fields + parsing |
| `src/engine/i18n.ts` | en / zh-CN, browser detection, saved choice wins | Rarely |
| `src/engine/assets.ts` | Cached GLTF/texture loading with progress | Use it for models |
| `src/game/config.ts` | Source defaults and active gameplay configuration | Yes |
| `src/game/tuning.ts` | Tweak catalog, atomic validation and activation boundaries | Yes |
| `src/game/rules.ts` | Run-state helpers retained from the starter | Rarely |
| `src/game/world.ts` | Night sky, garden, collidable cottage, birthday cake/letter, autumn tree/swing, tulips and NPCs | Yes |
| `src/game/forest-level.ts` | Moonlit fog forest, uneven terrain, glowing mushrooms, Forest Key and Garden Gate | Yes |
| `src/game/forest-quest.ts` | Pure `SEARCHING_KEY` → `KEY_FOUND` → `LEVEL_COMPLETE` quest transitions | Yes |
| `src/game/letter-quest.ts` | Pure Garden birthday-letter quest progression | Yes |
| `src/game/player.ts` | Raven controller, collisions, hopping and movement feel | Yes |
| `src/game/characters.ts` | Character fitting and stylized fallback meshes | Yes |
| `src/game/game.ts` | Forest-to-Garden transition, free roam, letter quest, Snowball and NPC interaction | Yes |
| `src/ui/`, `src/styles/main.css` | HTML/CSS title, HUD, quests, pausing letter popup, pause, settings and results | Yes |
| `src/i18n/*.json` | All player-facing text (both files, same keys) | Yes |

## Rules for changes

- **Simulation in `step()`, visuals in `render()`/`animate()`.** Gameplay state only changes in
  fixed steps; read presses there with `input.consume(action)`, never `pressed()`.
- **Rules stay pure.** Scoring, win/lose and progression go in `rules.ts` with tests; scene code
  reports events and reads state.
- **Every visible string is an i18n key** in both `en.json` and `zh-CN.json` (a test enforces
  matching keys and placeholders). The game is intentionally pinned to English; the second catalog is
  retained for key parity. Fonts are bundled in `public/fonts/`.
- **UI is HTML/CSS**, not canvas. Keep the game look: display font, outlined text, hard offset
  shadows, skewed buttons, notched panels. Menus must stay keyboard/gamepad navigable
  (`data-nav` on focusable controls).
- **Colliders come from the helpers** in `physics.ts` with the same sizes as the meshes.
- Keep `pnpm build` within the JS/font budgets (`scripts/check-size.mjs`) and `pnpm smoke` green.
  Total game asset size is reported without a hard limit.

## Controls

Keyboard/mouse: WASD walk, mouse look (click to capture), Shift jog, Space hop, F or left-click dash,
E near the Forest Key to collect it, E at the Garden Gate to unlock it, then E near a tulip to pick it,
near a bunny to feed it, near Beast Boy to chat, or inside the cottage to read the birthday letter;
Esc pauses or closes the letter.
Gamepad: left stick, right stick, LB jog, A hop, X/RB dash, Y to interact, Start pause.
Touch: left stick, right-side drag to look, HOP / DASH / ACT buttons. The garden HUD tracks
tulips picked and bunnies fed; a heart reaction shows when a bunny is enjoying its snack.

Music and nighttime ambience start when entering the forest and respect the Music slider and
Mute setting. Interaction cues respect the Effects slider.

## Cloudflare Pages download

The game is Vite static content: run `pnpm install --frozen-lockfile` and `pnpm build`,
then upload the contents of `dist/` to Cloudflare Pages as a static site. The convenience archives
named `tuliphollow-cloudflare-pages-2026-10-17.zip` and `tuliphollow-source-2026-10-17.zip` are
from the previous delivery and do **not** include the Dark Forest or Birthday Letter updates. The
current `tuliphollow-source-working-tree-2026-10-21.zip` is an editable snapshot of the tested local
working tree: it includes source and runtime assets, but omits Git history, installed dependencies,
screenshots, and generated `dist/`. It is not a canonical saved checkpoint. This project has not been
published to Cloudflare; a fresh Cloudflare upload archive and canonical checkpoint remain pending
managed-asset synchronization and the project save workflow.

## Credits

Fonts: ManusCC0 (regular, medium, bold) and ManusCC0 Sans CJK SC — CC0 1.0.
The bundled Chinese font preserves its 6,547-codepoint repertoire; no font download is required.
See `public/fonts/ManusCC0-LICENSE.txt`.
Tulip model: “Generic tulip flower” by assetfactory, [source](https://sketchfab.com/3d-models/generic-tulip-flower-d75f531255ad47a99051a4c421c8861b), Sketchfab Standard. The supplied license text is preserved in `assets/models/tulip-license.txt`; the full-resolution source GLB stays in `assets/models/tulip.glb`, and gameplay uses a 1024px-texture copy at `assets/models/tulip-optimized.glb`.
Libraries: three.js (MIT), Rapier (Apache-2.0).

## Preview Tweak

`src/game/tuning.ts` is this game's parameter manager. The Addon panel reads its
catalog; `config.ts` owns source defaults and the active configuration used by gameplay.
When adapting the game, keep only controls with actual gameplay consumers, and preserve
stable IDs for unchanged parameters. Define ranges, units and the correct activation
boundary. Register through `scripts/manus-tuning/adapter.js` only under `import.meta.env.DEV`.
Keep the Vite plugin and `scripts/__manus__/` helpers intact; production builds exclude
the browser adapter and never inject the bridge.

Apply changes preview state only. `LIVE` parameters are read in the next game update;
`NEXT_ACTION` parameters activate at the relevant jump/dash start; `NEXT_RUN` parameters
activate in `Game.start`. Model/collider size and gravity are not exposed by this version.
Do not mutate the source defaults or persist Apply to localStorage. Save with Manus
checks the snapshot against the current catalog and edits `DEFAULT_CONFIG`, then uses
the normal Three.js Web build/checkpoint workflow. Keep existing gameplay parameter
managers when extending an older project; do not create a competing store.

For server-authoritative multiplayer, expose local cosmetic controls only until gameplay
parameters have explicit server-side development support. The descriptor's GAMEPLAY flag
is a classification, not server authorization or ranked-score enforcement.

The preview plugin reads the ignored `.manus-webdev/preview-identity.json` v1 projection
written by the Runtime when initializing, attaching or restoring this project. It contains
only the resource ID and canonical project directory; private Host bindings and starter
receipts are not template dependencies. Missing identity disables the bridge.
The manager latches `tuning.unranked` when non-default GAMEPLAY values become active and
resets it only at the next run using that run's active values. `Game` snapshots this onto
`RunState.unranked`; local results cannot save such runs. Preserve this guard when changing
scoring. When adding online leaderboards, skip submissions for unranked runs and enforce
eligibility in the authoritative server too; client flags are not proof of a fair score.
