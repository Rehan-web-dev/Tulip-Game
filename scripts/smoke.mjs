// End-to-end smoke test: builds must already exist in dist/ (`pnpm build`).
// Serves dist/, verifies the forest, cottage and garden interactions, exercises menus/touch, and fails
// on any console, page or network error. Screenshots are written to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
// Isolated desktop, locale and touch contexts each reload the bundled GLBs in software WebGL.
const guard = setTimeout(() => fail('timed out'), 600_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 30_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    const expected = 'ManusCC0'
    for (const selector of ['.logo-text', '.tagline']) {
      const family = getComputedStyle(document.querySelector(selector)).fontFamily
      if (!family.startsWith(`"${expected}"`) && !family.startsWith(expected + ',')) {
        throw new Error(`Unexpected game font: ${family}`)
      }
    }
    if (![...document.fonts].some(face => face.family.replaceAll('"', '').replaceAll("'", '') === expected && face.status === 'loaded')) {
      throw new Error(`Bundled font did not load: ${expected}`)
    }
  })
  await page.waitForTimeout(900)
  return page
}

async function triggerTouchAction(page) {
  await page.evaluate(() => {
    const button = document.querySelector('.touch-talk')
    if (!button) throw new Error('touch ACT button is missing')
    // Playwright's software WebGL tap can stall; these events exercise the same registered pointer handlers.
    Object.defineProperty(button, 'setPointerCapture', { value: () => undefined, configurable: true })
    const event = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 }
    button.dispatchEvent(new PointerEvent('pointerdown', event))
    button.dispatchEvent(new PointerEvent('pointerup', event))
  })
}

async function interact(page, touch) {
  if (touch) await triggerTouchAction(page)
  else await page.keyboard.press('KeyE')
}

async function completeForestIntro(page, touch = false) {
  const forest = await page.evaluate(() => {
    const { game } = window.__game
    return {
      level: game.currentLevel,
      state: game['forest'].state,
      theme: game['forest'].scene.userData.theme,
      trees: game['forest'].scene.userData.treeCount,
      mushrooms: game['forest'].scene.userData.mushroomCount,
      stars: game['forest'].scene.userData.starShapeCount,
      lantern: game['snowball'].getObjectByName('Snowball lantern light')?.visible,
      quest: document.querySelector('.quest-text').textContent,
      location: document.querySelector('.garden-location').textContent,
      key: { x: game['forest'].keyPosition.x, z: game['forest'].keyPosition.z },
      gate: { x: game['forest'].gatePosition.x, z: game['forest'].gatePosition.z },
    }
  })
  if (forest.level !== 'forest' || forest.state !== 'SEARCHING_KEY') throw new Error(`new playthrough did not start in the forest: ${JSON.stringify(forest)}`)
  if (forest.theme !== 'moonlit-fog' || forest.trees < 60 || forest.mushrooms < 20 || forest.stars !== 52) throw new Error(`Dark Forest scenery is incomplete: ${JSON.stringify(forest)}`)
  if (!forest.lantern) throw new Error('Snowball forest lantern is not enabled')
  if (forest.quest !== 'Find the Forest Key' || forest.location !== 'The Dark Forest') throw new Error(`forest objective/location HUD is wrong: ${JSON.stringify(forest)}`)

  await page.evaluate(() => {
    const { game } = window.__game
    const gate = game['forest'].gatePosition
    game['player'].teleport({ x: gate.x - 3.4, y: 1.1, z: gate.z })
  })
  await interact(page, touch)
  await page.waitForFunction(() => [...document.querySelectorAll('.popup')].some(el => el.textContent?.includes('The Garden Gate is locked')))

  await page.evaluate(() => {
    const { game } = window.__game
    const key = game['forest'].keyPosition
    game['player'].teleport({ x: key.x, y: 1.1, z: key.z })
  })
  await interact(page, touch)
  await page.waitForFunction(() => window.__game.game['forest'].state === 'KEY_FOUND')
  const questAfterKey = await page.locator('.quest-text').textContent()
  if (!questAfterKey?.includes('Unlock the Garden Gate')) throw new Error(`forest quest did not update after key pickup: ${questAfterKey}`)

  await page.evaluate(() => {
    const { game } = window.__game
    const gate = game['forest'].gatePosition
    game['player'].teleport({ x: gate.x - 3.4, y: 1.1, z: gate.z })
  })
  await interact(page, touch)
  await page.waitForFunction(() => window.__game.game['forest'].state === 'LEVEL_COMPLETE', undefined, { timeout: 8_000 })
  await page.waitForFunction(() => window.__game.game.currentLevel === 'garden', undefined, { timeout: 8_000 })
  const gardenEntry = await page.evaluate(() => ({
    location: document.querySelector('.garden-location').textContent,
    quest: document.querySelector('.quest-text').textContent,
    gateOpen: window.__game.game['forest'].scene.userData.gateOpen,
    gateLight: window.__game.game['forest']['gateGoldLight'].intensity,
    leftDoorAngle: window.__game.game['forest']['leftGate'].rotation.y,
    rightDoorAngle: window.__game.game['forest']['rightGate'].rotation.y,
  }))
  if (!gardenEntry.gateOpen || gardenEntry.quest !== 'Read the birthday letter' || !gardenEntry.location?.includes('Tulip Garden') || gardenEntry.gateLight < 3 || Math.abs(gardenEntry.leftDoorAngle) < 1.4 || Math.abs(gardenEntry.rightDoorAngle) < 1.4) {
    throw new Error(`Garden Gate handoff did not finish cleanly: ${JSON.stringify(gardenEntry)}`)
  }
  return forest
}

async function verifyBirthdayLetter(page, touch = false) {
  const structure = await page.evaluate(() => {
    const { game } = window.__game
    const world = game['world']
    const letter = world.birthdayLetterPosition
    return {
      houseWallsSolid: world.scene.userData.houseWallsSolid,
      houseWallColliderCount: world.scene.userData.houseWallColliderCount,
      houseDoorwayWidth: world.scene.userData.houseDoorwayWidth,
      autumnTreeCount: world.scene.userData.autumnTreeCount,
      swingCount: world.scene.userData.gardenSwingCount,
      cakeCount: world.scene.userData.birthdayCakeCount,
      candleCount: world.scene.userData.cakeCandleCount,
      letterInteractable: world.scene.userData.birthdayLetterInteractable,
      quest: document.querySelector('.quest-text').textContent,
      letter: { x: letter.x, z: letter.z },
    }
  })
  if (!structure.houseWallsSolid || structure.houseWallColliderCount !== 6 || structure.houseDoorwayWidth < 4.5 || structure.autumnTreeCount !== 1 || structure.swingCount !== 1 || structure.cakeCount !== 1 || structure.candleCount < 3 || !structure.letterInteractable || structure.quest !== 'Read the birthday letter') {
    throw new Error(`cottage birthday scene or letter quest is incomplete: ${JSON.stringify(structure)}`)
  }

  if (!touch) {
    await page.evaluate(() => window.__game.game['player'].teleport({ x: 3.7, y: 1.1, z: -23 }))
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(700)
    await page.keyboard.up('KeyD')
    const wallProbe = await page.evaluate(() => window.__game.game['player'].root.position.x)
    if (wallProbe > 4.6 || wallProbe <= 3.7) throw new Error(`cottage side wall did not stop Raven: x=${wallProbe.toFixed(2)}`)
  }

  await page.evaluate(({ x, z }) => window.__game.game['player'].teleport({ x: x + 1.4, y: 1.1, z: z + 2 }), structure.letter)
  await interact(page, touch)
  await page.waitForSelector('[data-screen="letter"].is-active', { timeout: 8_000 })
  const expectedLetter = 'this is something i wanted to give you on your birthday....BABY!  and this can be a apology for the day i made you upset'
  const opened = await page.evaluate(() => {
    const { game, ui } = window.__game
    const world = game['world']
    const copy = document.querySelector('.letter-copy')
    return {
      text: copy.textContent,
      whiteSpace: getComputedStyle(copy).whiteSpace,
      mode: game.mode,
      screen: ui.screen,
      quest: document.querySelector('.quest-text').textContent,
      letterRead: world.scene.userData.birthdayLetterRead,
      insideHouse: world.scene.userData.houseInteriorActive,
    }
  })
  if (opened.text !== expectedLetter || opened.whiteSpace !== 'pre-wrap' || opened.mode !== 'paused' || opened.screen !== 'letter' || opened.quest !== 'Birthday letter read' || !opened.letterRead || !opened.insideHouse) {
    throw new Error(`birthday-letter interaction/modal state is wrong: ${JSON.stringify(opened)}`)
  }
  await page.screenshot({ path: `${out}/${touch ? '10-phone-birthday-letter.png' : '04-birthday-letter.png'}` })
  if (touch) await page.locator('[data-action="close-letter"]').click()
  else await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__game.game.mode === 'playing' && window.__game.ui.screen === 'hud', undefined, { timeout: 8_000 })
  await page.evaluate(() => {
    const { game } = window.__game
    const spawn = game['world'].spawn
    game['player'].teleport({ x: spawn.x, y: 1.1, z: spawn.z })
  })
}

const state = page => page.evaluate(() => {
  const { game } = window.__game
  const p = game['player'].root.position
  const companion = game['snowball'].position
  const world = game['world']
  const forest = game['forest'].scene.userData
  return {
    mode: game.mode,
    level: game.currentLevel,
    forestState: game['forest'].state,
    forestTheme: forest.theme,
    forestTrees: forest.treeCount,
    forestMushrooms: forest.mushroomCount,
    forestStars: forest.starShapeCount,
    forestLantern: game['snowball'].getObjectByName('Snowball lantern light')?.visible,
    run: game.run,
    pos: { x: p.x, y: p.y, z: p.z },
    companion: { x: companion.x, y: companion.y, z: companion.z },
    rabbits: world.rabbits.length,
    rabbitYs: world.rabbits.map(rabbit => rabbit.root.position.y),
    tulips: world.scene.userData.flowerCount,
    flowerBedsBySide: world.scene.userData.flowerBedsBySide,
    pathFlowerViolations: world.scene.userData.pathFlowerViolations,
    flowerColors: world.scene.userData.flowerColors,
    tulipModelLoaded: world.scene.userData.tulipModelLoaded,
    skyTheme: world.scene.userData.skyTheme,
    starShapes: world.scene.userData.starShapeCount,
    starColor: world.scene.userData.starColor,
    starMinScale: world.scene.userData.starMinScale,
    starMaxScale: world.scene.userData.starMaxScale,
    houseCount: world.scene.userData.houseCount,
    houseWallsSolid: world.scene.userData.houseWallsSolid,
    houseWallColliderCount: world.scene.userData.houseWallColliderCount,
    houseDoorwayWidth: world.scene.userData.houseDoorwayWidth,
    houseInteriorActive: world.scene.userData.houseInteriorActive,
    autumnTreeCount: world.scene.userData.autumnTreeCount,
    gardenSwingCount: world.scene.userData.gardenSwingCount,
    birthdayCakeCount: world.scene.userData.birthdayCakeCount,
    cakeCandleCount: world.scene.userData.cakeCandleCount,
    letterInteractable: world.scene.userData.birthdayLetterInteractable,
    letterRead: world.scene.userData.birthdayLetterRead,
    modelsLoaded: window.__game.modelsLoaded,
    tulipsPicked: game.tulipsPicked,
    bunniesFed: game.bunniesFed,
    audioLoaded: window.__game.audio.gardenAudioLoaded,
    musicPlaying: window.__game.audio.gardenMusicPlaying,
  }
})

try {
  await waitForServer()
  // Prefer Playwright's bundled Chromium; fall back to an installed Google Chrome.
  const args = ['--ignore-gpu-blocklist']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []

  const en = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(en, errors)
  await page.screenshot({ path: `${out}/01-title-en.png` })

  await page.click('[data-action="play"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await page.waitForFunction(() => window.__game.audio.gardenMusicPlaying)
  const forestState = await state(page)
  if (Object.values(forestState.audioLoaded).some(loaded => !loaded)) throw new Error(`generated game audio did not load: ${JSON.stringify(forestState.audioLoaded)}`)
  if (!forestState.musicPlaying) throw new Error('cozy nighttime music did not start after the play gesture')
  await page.screenshot({ path: `${out}/02-dark-forest.png` })
  await completeForestIntro(page)
  await verifyBirthdayLetter(page)
  const before = await state(page)
  if (before.level !== 'garden') throw new Error(`expected transition into the existing garden, got ${before.level}`)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(700)
  await page.keyboard.press('Space')
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/02-gameplay.png` })
  const after = await state(page)
  const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)
  if (after.mode !== 'playing') throw new Error(`expected playing, got ${after.mode}`)
  if (moved < 2) throw new Error(`player barely moved (${moved.toFixed(2)} m)`)
  if (await page.locator('.hud-clock').isVisible()) throw new Error('free-roam HUD should not show a countdown')
  if (after.rabbits < 8) throw new Error(`expected hopping rabbits, got ${after.rabbits}`)
  if (!after.rabbitYs.some((y, i) => Math.abs(y - before.rabbitYs[i]) > 0.08)) throw new Error('garden rabbits are not hopping')
  if (after.tulips < 3400) throw new Error(`garden should look fuller on both sides (${after.tulips} visible tulips)`)
  if (after.flowerBedsBySide.left < 850 || after.flowerBedsBySide.right < 850 || Math.abs(after.flowerBedsBySide.left - after.flowerBedsBySide.right) > 1) {
    throw new Error(`flower beds should be full and balanced on both garden sides: ${JSON.stringify(after.flowerBedsBySide)}`)
  }
  if (after.pathFlowerViolations !== 0) throw new Error(`tulips intrude on a path clearance corridor (${after.pathFlowerViolations})`)
  if (after.flowerColors < 5) throw new Error(`garden is missing colorful tulips (${after.flowerColors} colors)`)
  if (!after.tulipModelLoaded || !after.modelsLoaded?.tulip) throw new Error('the supplied tulip model did not load')
  if (after.skyTheme !== 'night' || after.starShapes < 40) throw new Error(`expected a starry night sky, got ${after.skyTheme} with ${after.starShapes} shaped stars`)
  if (after.starColor !== '#ffd54a' || after.starMinScale < 1 || after.starMaxScale < 1.6) {
    throw new Error(`night-sky stars should be larger and yellow: ${after.starColor}, scale ${after.starMinScale}–${after.starMaxScale}`)
  }
  if (after.houseCount < 1) throw new Error('the small garden house is missing')
  const missingModels = ['raven', 'snowball', 'beastBoy'].filter(key => !after.modelsLoaded?.[key])
  if (missingModels.length) throw new Error(`missing character models: ${missingModels.join(', ')}`)
  const companionDistance = Math.hypot(after.pos.x - after.companion.x, after.pos.z - after.companion.z)
  if (companionDistance > 4.5) throw new Error(`Snowball is not following (${companionDistance.toFixed(1)} m away)`)
  console.log(`smoke: moved ${moved.toFixed(1)} m; ${after.tulips} tulips; ${after.starShapes} star shapes; ${after.rabbits} rabbits; Snowball ${companionDistance.toFixed(1)} m away`)

  // Pick a visible garden tulip using the same E action as the player.
  const pickTarget = await page.evaluate(() => {
    const { game } = window.__game
    const world = game['world']
    const target = world['pickableTulips'].find(tulip => !tulip.picked && tulip.slots.length > 0 && world.rabbits.every(rabbit => Math.hypot(tulip.position.x - rabbit.root.position.x, tulip.position.z - rabbit.root.position.z) > 5) && Math.hypot(tulip.position.x - world.npcPosition.x, tulip.position.z - world.npcPosition.z) > 6)
    if (!target) throw new Error('no safely separated pickable tulip target')
    game['player'].teleport({ x: target.position.x, y: 1.1, z: target.position.z })
    return { x: target.position.x, z: target.position.z }
  })
  await page.keyboard.press('KeyE')
  await page.waitForFunction(() => window.__game.game.tulipsPicked === 1 && [...document.querySelectorAll('.popup')].some(el => el.textContent?.includes('tulip picked')), undefined, { timeout: 8_000 })
  const picked = await page.evaluate(target => {
    const { game } = window.__game
    const tulip = game['world']['pickableTulips'].find(item => item.position.x === target.x && item.position.z === target.z)
    const matrix = tulip.slots[0].mesh.instanceMatrix.array
    const offset = tulip.slots[0].index * 16
    const hidden = matrix[offset] === 0 && matrix[offset + 5] === 0 && matrix[offset + 10] === 0
    return { hidden: tulip.picked && hidden, slots: tulip.slots.length, hud: document.querySelector('[data-slot="picked"]').textContent }
  }, pickTarget)
  if (!picked.hidden || picked.slots < 3 || picked.hud !== '1') throw new Error(`picked tulip did not disappear/update the counter: ${JSON.stringify(picked)}`)

  // Feed a nearby hopping bunny and verify its heart/reaction and the player-facing counter.
  const bunnyTarget = await page.evaluate(() => {
    const { game } = window.__game
    const world = game['world']
    const bunny = world.rabbits.find(candidate => world['pickableTulips'].every(tulip => tulip.picked || Math.hypot(tulip.position.x - candidate.root.position.x, tulip.position.z - candidate.root.position.z) > 4.2) && Math.hypot(candidate.root.position.x - world.npcPosition.x, candidate.root.position.z - world.npcPosition.z) > 6)
    if (!bunny) throw new Error('no safely separated feedable bunny target')
    game['player'].teleport({ x: bunny.root.position.x, y: 1.1, z: bunny.root.position.z })
    return { x: bunny.x, z: bunny.z }
  })
  await page.keyboard.press('KeyE')
  await page.waitForFunction(() => window.__game.game.bunniesFed === 1 && [...document.querySelectorAll('.popup')].some(el => el.textContent?.includes('happily nibbling')), undefined, { timeout: 8_000 })
  const fed = await page.evaluate(target => {
    const { game } = window.__game
    const bunny = game['world'].rabbits.find(item => item.x === target.x && item.z === target.z)
    return { happy: bunny.heart.visible && bunny.fedUntil > 0, hud: document.querySelector('[data-slot="fed"]').textContent }
  }, bunnyTarget)
  if (!fed.happy || fed.hud !== '1') throw new Error(`fed bunny reaction/counter is missing: ${JSON.stringify(fed)}`)

  // Test the real interact action by moving Raven beside Beast Boy.
  const npcApproach = await page.evaluate(() => {
    const { game } = window.__game
    const world = game['world']
    const npc = world.npcPosition
    let best
    for (let i = 0; i < 72; i += 1) {
      const angle = i / 72 * Math.PI * 2
      const x = npc.x + Math.cos(angle) * 2.2
      const z = npc.z + Math.sin(angle) * 2.2
      const tulipDistance = Math.min(...world['pickableTulips'].filter(tulip => !tulip.picked).map(tulip => Math.hypot(x - tulip.position.x, z - tulip.position.z)), Infinity)
      const bunnyDistance = Math.min(...world.rabbits.map(bunny => Math.hypot(x - bunny.root.position.x, z - bunny.root.position.z)), Infinity)
      const otherDistance = Math.min(tulipDistance, bunnyDistance)
      if (!best || otherDistance > best.otherDistance) best = { x, z, otherDistance }
    }
    if (!best || best.otherDistance <= 2.2) throw new Error(`no clear Beast Boy talk position; nearest competing interaction is ${best?.otherDistance.toFixed(2)} m away`)
    game['player'].teleport({ x: best.x, y: 1.1, z: best.z })
    return best
  })
  await page.keyboard.press('KeyE')
  await page.waitForFunction(() => {
    const popup = [...document.querySelectorAll('.popup')].reverse().find(el => el.textContent?.includes('Beast Boy:'))
    if (!popup) return false
    window.__smokeBeastDialogue = popup.textContent
    return true
  }, undefined, { timeout: 8_000 })
  const dialogue = await page.evaluate(() => window.__smokeBeastDialogue)
  if (!dialogue?.includes('Beast Boy:')) throw new Error(`expected Beast Boy dialogue, got ${dialogue}`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/03-beast-boy.png` })

  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/04-pause.png` })
  await page.click('[data-screen="pause"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/05-settings.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(300)
  if ((await state(page)).mode !== 'paused') throw new Error('leaving Settings with Escape resumed the run')

  await en.close()

  const zh = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
  const zhPage = await openGame(zh, errors)
  const lang = await zhPage.evaluate(() => document.documentElement.lang)
  if (lang !== 'en') throw new Error(`game should remain English on a Chinese browser (lang=${lang})`)
  if (!(await zhPage.locator('.logo-text').textContent()).includes('Tulip Hollow')) throw new Error('English title is missing')
  await zhPage.screenshot({ path: `${out}/06-title-en-only.png` })
  await zh.close()

  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' })
  const phonePage = await openGame(phone, errors)
  await phonePage.evaluate(() => document.querySelector('[data-action="play"]').click())
  await phonePage.waitForSelector('[data-screen="hud"].is-active')
  const phoneForest = await state(phonePage)
  if (phoneForest.level !== 'forest' || phoneForest.forestState !== 'SEARCHING_KEY' || !phoneForest.forestLantern) throw new Error(`mobile play did not begin in the Dark Forest with Snowball's lantern: ${JSON.stringify(phoneForest)}`)
  await phonePage.screenshot({ path: `${out}/07-phone-dark-forest.png` })
  await completeForestIntro(phonePage, true)
  await verifyBirthdayLetter(phonePage, true)
  const phoneState = await state(phonePage)
  if (Object.values(phoneState.audioLoaded).some(loaded => !loaded) || !phoneState.musicPlaying) throw new Error('mobile game did not preload/start garden audio')
  if (phoneState.tulips < 1300 || phoneState.flowerBedsBySide.left < 340 || phoneState.flowerBedsBySide.right < 340 || Math.abs(phoneState.flowerBedsBySide.left - phoneState.flowerBedsBySide.right) > 1 || phoneState.pathFlowerViolations !== 0 || phoneState.skyTheme !== 'night' || phoneState.starShapes < 40 || phoneState.starColor !== '#ffd54a' || phoneState.starMinScale < 1 || phoneState.starMaxScale < 1.6) {
    throw new Error(`mobile garden update incomplete: ${phoneState.tulips} tulips; beds ${JSON.stringify(phoneState.flowerBedsBySide)}; ${phoneState.pathFlowerViolations} path intrusions; stars ${phoneState.starShapes} ${phoneState.starColor} scale ${phoneState.starMinScale}–${phoneState.starMaxScale}`)
  }
  await phonePage.waitForTimeout(1200)
  await phonePage.screenshot({ path: `${out}/07-phone-hud.png` })
  const mobileBunnyTarget = await phonePage.evaluate(() => {
    const { game } = window.__game
    const world = game['world']
    const bunny = world.rabbits.find(candidate => world['pickableTulips'].every(tulip => Math.hypot(tulip.position.x - candidate.root.position.x, tulip.position.z - candidate.root.position.z) > 4.2) && Math.hypot(candidate.root.position.x - world.npcPosition.x, candidate.root.position.z - world.npcPosition.z) > 6)
    if (!bunny) throw new Error('no mobile feedable bunny target separated from flowers and NPC')
    game['player'].teleport({ x: bunny.root.position.x, y: 1.1, z: bunny.root.position.z })
    return { x: bunny.x, z: bunny.z }
  })
  await triggerTouchAction(phonePage)
  if (await phonePage.evaluate(() => window.__game.input.method) !== 'touch') throw new Error('ACT did not switch to touch input mode')
  await phonePage.waitForFunction(() => window.__game.game.bunniesFed === 1, { timeout: 5_000 })
  const mobileFeed = await phonePage.evaluate(target => {
    const { game } = window.__game
    const bunny = game['world'].rabbits.find(item => item.x === target.x && item.z === target.z)
    return { happy: bunny.heart.visible && bunny.fedUntil > 0, hud: document.querySelector('[data-slot="fed"]').textContent }
  }, mobileBunnyTarget)
  if (!mobileFeed.happy || mobileFeed.hud !== '1') throw new Error(`mobile ACT feeding did not trigger the bunny reaction: ${JSON.stringify(mobileFeed)}`)
  await phonePage.screenshot({ path: `${out}/08-phone-bunny-feed.png` })
  const mobileNpcApproach = await phonePage.evaluate(() => {
    const { game } = window.__game
    const world = game['world']
    const npc = world.npcPosition
    let best
    for (let i = 0; i < 72; i += 1) {
      const angle = i / 72 * Math.PI * 2
      const x = npc.x + Math.cos(angle) * 2.2
      const z = npc.z + Math.sin(angle) * 2.2
      const tulips = Math.min(...world['pickableTulips'].filter(item => !item.picked).map(item => Math.hypot(x - item.position.x, z - item.position.z)), Infinity)
      const bunnies = Math.min(...world.rabbits.map(item => Math.hypot(x - item.root.position.x, z - item.root.position.z)), Infinity)
      const otherDistance = Math.min(tulips, bunnies)
      if (!best || otherDistance > best.otherDistance) best = { x, z, otherDistance }
    }
    if (!best || best.otherDistance <= 2.2) throw new Error(`no safe phone NPC approach: ${best?.otherDistance}`)
    game['player'].teleport({ x: best.x, y: 1.1, z: best.z })
    return best
  })
  await triggerTouchAction(phonePage)
  await phonePage.waitForFunction(() => {
    const popup = [...document.querySelectorAll('.popup')].reverse().find(el => el.textContent?.includes('Beast Boy:'))
    if (!popup) return false
    window.__smokeTouchBeastDialogue = popup.textContent
    return true
  }, undefined, { timeout: 8_000 })
  const touchDialogue = await phonePage.evaluate(() => window.__smokeTouchBeastDialogue)
  if (!touchDialogue?.includes('Beast Boy:')) throw new Error(`touch TALK did not trigger dialogue: ${touchDialogue}`)
  await phonePage.screenshot({ path: `${out}/09-phone-beast-boy.png` })
  await phone.close()

  if (errors.length) throw new Error(`console errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — screenshots in ${out}/`)
} catch (err) {
  await fail(err?.message ?? String(err))
}
