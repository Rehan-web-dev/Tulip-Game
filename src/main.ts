import './styles/main.css'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Game } from './game/game'
import { TouchControls } from './ui/touch'
import { Ui } from './ui/ui'

const MODEL_URLS = {
  raven: new URL('../assets/Raven Movements/raven1_idle.glb', import.meta.url).href,
  ravenWalking: new URL('../assets/Raven Movements/raven1_walking.glb', import.meta.url).href,
  ravenSitting: new URL('../assets/Raven Movements/raven1_sitting.glb', import.meta.url).href,
  ravenRunning: new URL('../assets/Raven Movements/raven1_running.glb', import.meta.url).href,
  snowball: new URL('../assets/models/snowball.glb', import.meta.url).href,
  beastBoy: new URL('../assets/models/beast-boy.glb', import.meta.url).href,
  tulip: new URL('../assets/models/tulip-optimized.glb', import.meta.url).href,
}
const AUDIO_URLS = {
  music: new URL('../assets/audio/garden-at-night.mp3', import.meta.url).href,
  ambience: new URL('../assets/audio/night-garden-ambience.mp3', import.meta.url).href,
  pick: new URL('../assets/audio/tulip-pick.mp3', import.meta.url).href,
  feed: new URL('../assets/audio/bunny-feed.mp3', import.meta.url).href,
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()

  const i18n = new I18n('en')
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined
  let lockLostAt = 0

  const applySettings = (d: SaveData) => {
    input.sensitivity = d.sensitivity
    input.invertY = d.invertY
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
    if (game) game.reducedMotion = d.reducedMotion
  }

  const startRun = (tutorial: boolean) => {
    if (!game) return
    audio.unlock()
    audio.startMusic()
    game.start(tutorial)
    ui.show('hud')
    loop.resetAccumulator()
    input.lockPointer()
  }
  const pause = () => {
    if (game?.mode !== 'playing') return
    game.pause()
    ui.show('pause')
    input.unlockPointer()
  }
  const resume = () => {
    if (game?.mode !== 'paused') return
    game.resume()
    ui.show('hud')
    loop.resetAccumulator()
    input.lockPointer()
  }

  const ui = new Ui(i18n, save, audio, input, {
    play: () => startRun(!save.data.tutorialDone),
    restart: () => startRun(false),
    resume,
    pause: () => {
      if (game?.mode !== 'playing') return
      game.pause()
      input.unlockPointer()
    },
    quit: () => {
      game?.toTitle()
      ui.show('title')
      input.unlockPointer()
    },
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (patch.locale) i18n.set(patch.locale)
      if (qualityChanged) game?.setQuality(save.data.quality)
    },
  })
  ui.show('boot')
  applySettings(save.data)

  // Boot: keep three.js, Rapier (WASM), the game and its character models behind the garden loader.
  let loaded = 0
  const track = <T>(p: Promise<T>): Promise<T> => p.then(v => (ui.setBootProgress(0.1 + (++loaded / 5) * 0.5), v))
  ui.setBootProgress(0.1)
  const [{ Game }, { Renderer, suggestQuality }, physics, { Assets }] = await Promise.all([
    track(import('./game/game')),
    track(import('./engine/renderer')),
    track(import('./engine/physics')),
    track(import('./engine/assets')),
    track(document.fonts.ready),
  ])
  const assets = new Assets()
  const removeAssetProgress = assets.onProgress(progress => ui.setBootProgress(0.6 + progress * 0.32))
  const loadModel = async (name: string, url: string): Promise<GLTF | undefined> => {
    try {
      return await assets.gltf(url)
    } catch (error) {
      console.error(`Could not load ${name}; using its built-in fallback.`, error)
      return undefined
    }
  }
  const [ravenModel, ravenWalkingModel, ravenSittingModel, ravenRunningModel, snowballModel, beastBoyModel, tulipModel] = await Promise.all([
    loadModel('Raven', MODEL_URLS.raven),
    loadModel('Raven walking movement', MODEL_URLS.ravenWalking),
    loadModel('Raven sitting movement', MODEL_URLS.ravenSitting),
    loadModel('Raven running movement', MODEL_URLS.ravenRunning),
    loadModel('Snowball', MODEL_URLS.snowball),
    loadModel('Beast Boy', MODEL_URLS.beastBoy),
    loadModel('the supplied tulip', MODEL_URLS.tulip),
  ])
  removeAssetProgress()
  const modelsLoaded = {
    raven: ravenModel !== undefined,
    ravenWalking: ravenWalkingModel !== undefined,
    ravenSitting: ravenSittingModel !== undefined,
    ravenRunning: ravenRunningModel !== undefined,
    snowball: snowballModel !== undefined,
    beastBoy: beastBoyModel !== undefined,
    tulip: tulipModel !== undefined,
  }
  const loadSound = async (name: string, url: string): Promise<AudioBuffer | undefined> => {
    try {
      return await audio.load(url)
    } catch (error) {
      console.warn(`Could not load ${name}; the in-game audio fallback will be used.`, error)
      return undefined
    }
  }
  const [gardenMusic, nightAmbience, tulipPick, bunnyFeed] = await Promise.all([
    loadSound('garden music', AUDIO_URLS.music),
    loadSound('night garden ambience', AUDIO_URLS.ambience),
    loadSound('tulip picking sound', AUDIO_URLS.pick),
    loadSound('bunny feeding sound', AUDIO_URLS.feed),
  ])
  audio.setGardenAudio({ music: gardenMusic, ambience: nightAmbience, pick: tulipPick, feed: bunnyFeed })
  await physics.initPhysics()
  ui.setBootProgress(0.96)
  if (firstRun) {
    save.update({ quality: suggestQuality() })
    ui.refreshSettings()
  }

  const renderer = new Renderer(canvas, save.data.quality)
  game = new Game(renderer, input, audio, {
    popup: (text, at, kind) => ui.popup(text, at, kind),
    hurt: () => ui.hurt(),
    hint: hint => ui.hint(hint),
    quest: key => ui.quest(key),
    location: key => ui.location(key),
    forestMode: active => ui.forestMode(active),
    fade: active => ui.fade(active),
    text: key => ui.text(key),
    openLetter: () => ui.openLetter(),
    tutorialDone: () => save.update({ tutorialDone: true }),
    end: run => {
      input.unlockPointer()
      window.setTimeout(() => ui.showResults(run), run.phase === 'won' ? 1400 : 900)
    },
  }, {
    raven: ravenModel?.scene,
    ravenMovements: {
      walking: ravenWalkingModel?.animations,
      sitting: ravenSittingModel?.animations,
      running: ravenRunningModel?.animations,
      standing: ravenModel?.animations,
    },
    snowball: snowballModel?.scene,
    beastBoy: beastBoyModel?.scene,
    tulip: tulipModel?.scene,
  })
  game.reducedMotion = save.data.reducedMotion
  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }
  const g = game

  const loop = new GameLoop({
    step: dt => g.step(dt),
    render: (alpha, frameSeconds) => {
      if (input.consume('pause') && performance.now() - lockLostAt > 300) {
        if (g.mode === 'playing') pause()
        else if (g.mode === 'paused' && ui.screen === 'pause') resume()
      }
      ui.frame(frameSeconds)
      loop.paused = g.mode === 'paused'
      g.render(alpha, frameSeconds)
      if (g.mode === 'playing' || g.mode === 'ended') {
        ui.updateHud(g.run, g.compass())
        ui.updateGardenActivities(g.tulipsPicked, g.bunniesFed)
      }
    },
  })
  loop.start()
  ui.setBootProgress(1)

  document.addEventListener('pointerlockchange', () => {
    // Browsers release pointer lock on Escape without delivering the key: treat that as pause.
    if (!document.pointerLockElement && g.mode === 'playing' && input.method === 'keyboard') {
      lockLostAt = performance.now()
      pause()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  window.addEventListener('game:pause', pause)
  canvas.addEventListener('click', () => {
    if (g.mode === 'playing') input.lockPointer()
  })
  new TouchControls(document.getElementById('ui')!, input, () => g.mode === 'playing')

  window.setTimeout(() => ui.show('title'), 250)
  // Debug/test hook (read-only use): smoke tests inspect run state through it.
  ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save, modelsLoaded, audio }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  if (el) {
    const message = String((err as Error)?.message ?? err).replace(/[<>&]/g, '')
    el.innerHTML = `<div class="fatal"><strong>Garden could not load.</strong><p>${message}</p><button type="button">Retry</button></div>`
    el.querySelector('button')?.addEventListener('click', () => location.reload())
  }
})
