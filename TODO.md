# Tulip Hollow — To Do

## Original game outcomes
- [x] Build a small 3D open-world game in English with free exploration.
- [x] Include a small house and a large garden with colorful tulips.
- [x] Populate the garden with hopping bunnies.
- [x] Make Raven from *Teen Titans* the playable character.
- [x] Add Snowball from *The Secret Life of Pets* as a companion.
- [x] Add Beast Boy from *Teen Titans Go* as an NPC, with an interaction and dialogue.
- [x] Generate and integrate custom GLB models for all three named characters.

## Supplied tulip and night setting
- [x] Add the user's tulip model and fuller flower beds on both sides: 3,600 desktop blossoms and a lighter, mobile-friendly 1,400 on touch devices.
- [x] Keep walkable center, side, and stepping-stone paths tulip-free with an expanded clearance corridor.
- [x] Use 72 larger, yellow five-point stars in the nighttime sky and keep the cottage windows warm.
- [ ] Replace Raven, Snowball and Beast Boy with the user's rigged character models after the files are provided; keep the current models until then.

## Interactive garden
- [x] Let the player pick nearby garden tulips through a contextual interaction; visibly remove the picked flower, update a picked-tulip counter, and show written/sound feedback.
- [x] Let the player feed nearby hopping bunnies through the same interaction control; show a happy heart/nibbling reaction, count each feeding, and provide written/sound feedback. Each bunny has a short feeding cooldown.
- [x] Make the contextual actions available with keyboard/gamepad and the on-screen mobile ACT button; preserve Beast Boy's existing talk interaction.

## Intro level: The Dark Forest
- [x] Start a new playthrough in **The Dark Forest**, a moonlit, foggy nighttime forest with trees, rocks, uneven terrain, and glowing mushrooms/foliage; keep Raven and the existing Snowball model until replacement character models are supplied.
- [x] Keep Snowball beside Raven and give the rabbit a localized warm lantern light that helps illuminate the forest.
- [x] Use an explicit forest quest state machine with `SEARCHING_KEY`, `KEY_FOUND`, and `LEVEL_COMPLETE`; place a bobbing, sparkling **Forest Key** in the forest and allow it to be found through the nearby interaction control.
- [x] Place the **Garden Gate** at the forest boundary. It stays locked until Raven has the Forest Key; interacting while locked explains that the key is required.
- [x] With the Forest Key, interacting with the Garden Gate opens it with a golden-light spill, then fades into the already-existing **The Tulip Garden** level without removing its flowers, bunnies, house, Beast Boy, or interactions.
- [x] Show a persistent English forest quest tracker that changes from **Find the Forest Key** to **Unlock the Garden Gate**, then clears on Tulip Garden arrival while the separate birthday-letter objective begins; show the correct current-level location label.
- [x] Keep the forest environment, quest/transition logic, existing Tulip Garden, companion behavior, and UI in modular Three.js/ES6 modules, with forest quest state changes covered by deterministic tests.

## Autumn Cottage and Birthday Letter
- [x] Add a large autumn-colored tree beside the house with a big wooden swing hanging from its branches; leave a tulip-free clearance around the swing.
- [x] Make the cottage walls solid so Raven cannot pass through them, while keeping the doorway usable so she can enter the house.
- [x] Put an interior table in the house with a birthday cake and lit candles on top.
- [x] Add a birthday-letter side quest that lets Raven use E near the letter (with the existing gamepad/mobile interaction equivalents) to open a readable pop-up letter, then close it to resume exploring. The letter must say exactly: `this is something i wanted to give you on your birthday....BABY!  and this can be a apology for the day i made you upset`.
- [x] Show the letter objective in the HUD, update it after the letter is read, preserve the exact note text in the English UI, and keep both locale dictionaries' keys in parity.

## Music and sound
- [x] Add cozy generated instrumental background music that loops during play and respects the existing Music volume/mute settings and browser audio-unlock behavior.
- [x] Add generated nighttime cricket-and-breeze ambience that loops quietly during play through the existing Music bus/settings.
- [x] Add generated flower-picking and bunny-feeding sound effects through the existing SFX volume/mute settings.

## Download for Cloudflare
- [ ] Refresh and verify the Cloudflare Pages-ready ZIP with the new forest intro and latest production files at the archive root, so the user can upload the files themselves.
- [x] Create `tuliphollow-source-working-tree-2026-10-21.zip` from the tested current working tree, including source, lockfiles, licenses, and runtime assets while excluding Git history, installed dependencies, screenshots, and `dist/`; identify it as an uncheckpointed snapshot.
- [x] Do not publish the game to Cloudflare or Manus on the user's behalf.

## Existing verified delivery
- [x] Keep the Tulip Hollow title/loading screen and game-specific favicon.
- [x] Preserve movement, camera, save/settings and Tweak systems.
- [x] Pass all 45 unit tests, TypeScript diagnostics, and the production build/size guard.
- [x] Pass the end-to-end desktop/mobile browser smoke suite: moonlit Dark Forest scene and Snowball lantern, locked-gate feedback, Forest Key pickup and quest update, golden-light gate animation and fade into the Garden; solid cottage side-wall collision and usable doorway clearance, autumn tree and swing, candlelit birthday cake, exact birthday-letter copy, Garden quest completion, modal pause/read/close on keyboard and mobile ACT; clear garden paths, balanced flower beds, yellow star metrics, tulip picking, bunny feeding, Beast Boy dialogue, audio loading/startup, and mobile control-handler events.
- [x] Preserve the previously synchronized character GLBs, supplied tulip GLBs, favicon, and tulip creator/source/license attribution.
- [x] Bundle the generated music and sound files in the production build and source workspace.
- [ ] Register the previously generated audio in the managed asset store, categorize it, and save/push a new canonical checkpoint. The inherited `GAME_RUNTIME` helper path is absent and the active continuation receipt did not provide a replacement; do not raw-commit managed binaries.

## Notes
- Automated mobile control testing dispatched touch PointerEvents to the actual on-screen control handlers because this sandbox's Playwright tap/click injection stalled on the continuously rendered WebGL canvas. Please verify actual touch behavior on a real device if mobile play is important.
- Auto-publishing is disabled. The user requested Cloudflare-ready files, not public publication; nothing has been published.
- Social Open Graph artwork was not generated; the playable Preview does not include a custom social cover.
