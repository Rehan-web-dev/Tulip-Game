import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics, RAPIER } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { FollowCamera } from './camera'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { Effects } from './fx'
import { Player, type PlayerEvent, type RavenModels } from './player'
import { collect, createRun, damage, tick, type RunState } from './rules'
import { createSnowball, fitCharacterModel } from './characters'
import { ForestLevel, type ForestPrompt } from './forest-level'
import { advanceLetterQuest, INITIAL_LETTER_QUEST_STATE, type LetterQuestState } from './letter-quest'
import { World } from './world'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'
export type Hint = 'move' | 'look' | 'jump' | 'dash' | 'talk' | 'pick' | 'feed' | 'swing' | 'edge' | 'garden' | 'cores' | 'letter' | ForestPrompt
export type LevelId = 'forest' | 'garden'
export type Compass = { angle: number; distance: number; rise: number }

export type GameHooks = {
  popup(text: string, screen: { x: number; y: number }, kind: 'score' | 'hurt'): void
  hurt(): void
  hint(hint: Hint | null): void
  quest(key: string | null): void
  location(key: string): void
  forestMode(active: boolean): void
  fade(active: boolean): void
  text(key: string): string
  openLetter(): void
  tutorialDone(): void
  end(run: RunState): void
}

/** Owns both levels and turns input into relaxed third-person exploration and quest progression. */
export class Game {
  mode: Mode = 'attract'
  run: RunState
  tulipsPicked = 0
  bunniesFed = 0
  reducedMotion = false
  private readonly physics: Physics
  private readonly world: World
  readonly forest: ForestLevel
  private readonly player: Player
  private readonly snowball: THREE.Group
  private readonly cam: FollowCamera
  private readonly fx = new Effects()
  private activeScene: THREE.Scene
  private activeLevel: LevelId = 'garden'
  private transitionRemaining = 0
  private transitioning = false
  private simTime = 0
  private time = 0
  private letterQuest: LetterQuestState = INITIAL_LETTER_QUEST_STATE
  private tutorial: Hint | null = null
  private tutorialStart = new THREE.Vector3()
  private lastHint: Hint | null = null
  private dialogueIndex = 0
  private readonly down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private readonly dialogue = [
    'I have officially counted seventeen different tulip colors. Probably.',
    'Snowball keeps trying to race the bunnies. He says it is research.',
    'That little house is the perfect place to take a break.',
    'This garden is pretty great. You two should come back whenever you like.',
  ]

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
    models: { raven?: THREE.Object3D; ravenMovements?: RavenModels; snowball?: THREE.Object3D; beastBoy?: THREE.Object3D; tulip?: THREE.Object3D } = {},
  ) {
    this.physics = new Physics(CONFIG.player.gravity)
    this.world = new World(this.physics, renderer.shadowMapSize, models.beastBoy, models.tulip)
    this.forest = new ForestLevel(this.physics, renderer.shadowMapSize)
    this.player = new Player(this.physics, this.world.spawn, this.world.movers, models.raven, models.ravenMovements)
    this.player.setPose('sitting')
    this.snowball = fitCharacterModel(models.snowball ?? createSnowball(), 0.82, 'floor')
    const lanternBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#ffe1a8', emissive: '#ff9f42', emissiveIntensity: 1.05, roughness: 0.42 }),
    )
    lanternBulb.position.set(0, 0.68, -0.28)
    lanternBulb.name = 'Snowball lantern bulb'
    this.snowball.add(lanternBulb)
    const lantern = new THREE.PointLight('#ffbd70', 2.15, 10, 1.55)
    lantern.position.copy(lanternBulb.position)
    lantern.name = 'Snowball lantern light'
    this.snowball.add(lantern)
    lantern.visible = false
    this.snowball.position.set(this.world.spawn.x + 1.2, 0, this.world.spawn.z + 1.5)
    this.cam = new FollowCamera(this.physics, this.player.collider)
    this.world.scene.add(this.player.root, this.player.shadowMesh, this.snowball, this.fx.mesh)
    this.activeScene = this.world.scene
    this.run = createRun(this.world.collectibles.total)
    this.cam.reset(this.world.spawn, 0)
    this.renderer.prepare(this.world.scene, this.cam.camera)
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cam.camera
  }

  get currentLevel(): LevelId {
    return this.activeLevel
  }

  start(tutorial: boolean): void {
    tuning.activate('run')
    this.fx.clear()
    this.forest.reset()
    this.letterQuest = INITIAL_LETTER_QUEST_STATE
    this.world.resetBirthdayLetter()
    this.world.resetRun()
    this.activateLevel('forest')
    this.run = { ...createRun(this.world.collectibles.total), unranked: tuning.unranked }
    this.mode = 'playing'
    this.player.setPose('standing')
    this.input.endFrame()
    this.input.takeLook()
    this.tutorial = tutorial ? 'move' : null
    this.tutorialStart.copy(this.forest.spawn)
    this.dialogueIndex = 0
    this.setHint(this.tutorial)
    this.hooks.quest('quest.forest.find')
    this.hooks.location('hud.locationForest')
    this.hooks.forestMode(true)
    this.hooks.fade(false)
  }

  pause(): void {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      this.player.setPose('sitting')
    }
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.player.setPose('standing')
    this.input.endFrame()
    this.input.takeLook()
  }

  toTitle(): void {
    this.mode = 'attract'
    this.player.setPose('sitting')
    this.audio.stopMusic()
    this.transitioning = false
    this.activateLevel('garden')
    this.hooks.quest(null)
    this.hooks.location('hud.location')
    this.hooks.forestMode(false)
    this.hooks.fade(false)
    this.setHint(null)
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const size = this.renderer.shadowMapSize
    const shadow = this.world.sun.shadow
    shadow.map?.dispose()
    shadow.map = null
    shadow.mapSize.set(size, size)
    this.world.scene.traverse(obj => {
      const material = (obj as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }

  step(dt: number): void {
    this.input.update()
    this.simTime += dt
    const jumpPressed = this.input.consume('jump')
    const dashPressed = this.input.consume('dash')
    const interactPressed = this.input.consume('interact')
    const playing = this.mode === 'playing'
    this.world.stepMovers(dt, this.run.timeLeft <= CONFIG.drones.rageAt)
    const events: PlayerEvent[] = []
    if (playing) {
      this.player.step(dt, {
        moveX: this.input.move.x,
        moveY: this.input.move.y,
        sprint: this.input.held('sprint'),
        jumpPressed,
        jumpHeld: this.input.held('jump'),
        dashPressed,
      }, this.cam.yaw, events)
    }
    this.physics.step(dt)
    if (!playing) return

    const pos = this.player.position
    this.run = tick(this.run, dt)
    this.run = { ...this.run, unranked: this.run.unranked || tuning.unranked }
    if (this.run.phase === 'lost') {
      this.finishRun()
      return
    }
    if (this.activeLevel === 'garden') {
      this.applyGardenRunEvents(pos)
      if (this.run.phase !== 'playing') return
    }
    if (this.tutorial === 'move' && pos.distanceTo(this.tutorialStart) > 2.5) {
      this.tutorial = null
      this.hooks.tutorialDone()
    }
    for (const event of events) this.onPlayerEvent(event, pos)

    if (this.activeLevel === 'forest') {
      const prompt = this.forest.prompt(pos)
      this.setHint(prompt ?? this.tutorial)
      if (interactPressed) this.handleForestInteraction(pos)
      return
    }

    if (this.world.isNearBoundary(pos)) {
      this.setHint('edge')
      return
    }

    if (this.world.isNearBirthdayLetter(pos, 3.25)) {
      this.setHint('letter')
      if (interactPressed) this.readBirthdayLetter()
      return
    }

    const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
    const tulip = this.world.nearestPickableTulip(pos, 3.2)
    const bunny = this.world.nearestFeedableBunny(pos, 3.5)
    const npcDistance = horizontalDistance(pos, this.world.npcPosition)
    const swingDistance = horizontalDistance(pos, this.world.swingSeatPosition)
    if (swingDistance < 2.8 || this.player.isSeatedOnSwing) {
      this.setHint('swing')
      if (interactPressed) {
        if (this.player.isSeatedOnSwing) this.player.standFromSwing()
        else this.player.sitOnSwing(this.world.swingSeatPosition, this.cam.yaw)
        this.audio.play('ui')
      }
      return
    }
    let nearestDistance = Infinity
    let nearbyKind: 'talk' | 'pick' | 'feed' | null = null
    if (tulip) {
      nearestDistance = horizontalDistance(pos, tulip.position)
      nearbyKind = 'pick'
    }
    if (bunny) {
      const distance = horizontalDistance(pos, bunny.root.position)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearbyKind = 'feed'
      }
    }
    if (npcDistance < 5.4 && npcDistance < nearestDistance) {
      nearestDistance = npcDistance
      nearbyKind = 'talk'
    }
    this.setHint(nearbyKind === 'pick' ? 'pick' : nearbyKind === 'feed' ? 'feed' : nearbyKind === 'talk' ? 'talk' : this.tutorial ?? 'garden')

    if (!interactPressed || nearbyKind === null) return
    if (nearbyKind === 'talk' && npcDistance < 5.4) {
      const line = this.dialogue[this.dialogueIndex % this.dialogue.length]
      this.dialogueIndex += 1
      this.audio.play('ui')
      this.hooks.popup(`Beast Boy: ${line}`, this.project(this.world.npcPosition.clone().add(new THREE.Vector3(0, 1.75, 0))), 'score')
    } else if (nearbyKind === 'pick' && tulip && this.world.pickTulip(tulip)) {
      this.tulipsPicked += 1
      this.audio.playGardenSfx('pick')
      this.hooks.popup('A tulip picked for your garden.', this.project(tulip.position.clone().add(new THREE.Vector3(0, 1.2, 0))), 'score')
    } else if (nearbyKind === 'feed' && bunny && this.world.feedBunny(bunny)) {
      this.bunniesFed += 1
      this.audio.playGardenSfx('feed')
      this.hooks.popup('The bunny is happily nibbling.', this.project(bunny.root.position.clone().add(new THREE.Vector3(0, 1.15, 0))), 'score')
    }
  }

  render(alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    this.physics.sync(alpha)
    const target = this.player.root.position
    if (this.mode === 'attract') {
      const t = this.time * 0.045 + 0.85
      this.cam.camera.position.set(Math.sin(t) * 47, 24 + Math.sin(this.time * 0.18) * 1.2, -5 + Math.cos(t) * 47)
      this.cam.camera.lookAt(0, 2, -6)
    } else {
      const look = this.mode === 'playing' ? this.input.takeLook() : { x: 0, y: 0 }
      this.cam.update(target, look, frameSeconds, false, this.reducedMotion)
      if (this.mode === 'playing') this.player.setFacing(this.cam.yaw)
    }

    this.player.animate(frameSeconds, this.time, false, this.groundBelow(target))
    this.updateSnowball(frameSeconds)
    this.fx.update(frameSeconds)
    this.world.update(frameSeconds, this.activeLevel === 'garden' ? target : this.world.spawn)
    if (this.player.isSeatedOnSwing) this.player.setFacing(this.cam.yaw)
    this.player.followSwing(this.world.getSwingSeatPosition())
    const forestComplete = this.forest.update(frameSeconds)
    if (this.activeLevel === 'forest' && forestComplete && !this.transitioning) {
      this.transitioning = true
      this.transitionRemaining = 0.82
      this.hooks.fade(true)
    }

    if (this.transitioning) {
      this.transitionRemaining -= frameSeconds
      if (this.transitionRemaining <= 0) {
        this.activateLevel('garden')
        this.hooks.quest(this.letterQuest === 'LETTER_READ' ? 'quest.letter.done' : 'quest.letter.find')
        this.hooks.location('hud.location')
        this.hooks.forestMode(false)
        this.hooks.fade(false)
        this.transitioning = false
      }
    }
    this.renderer.render(this.activeScene, this.cam.camera)
  }

  private applyGardenRunEvents(pos: THREE.Vector3): void {
    const picked = this.world.collectibles.collect(pos, 1.35)
    for (const position of picked) {
      const result = collect(this.run)
      this.run = { ...result.state, unranked: this.run.unranked }
      this.world.scene.userData.collectiblesRemaining = this.world.collectibles.remaining().length
      this.audio.play('ui')
      this.hooks.popup(`+${result.points}`, this.project(position.clone().setY(1.8)), 'score')
    }
    if (this.run.phase === 'won') {
      this.finishRun()
      return
    }
    const hits = this.world.drones.hits(pos, CONFIG.player.radius)
    if (hits.length > 0) {
      const result = damage(this.run)
      this.run = { ...result.state, unranked: this.run.unranked }
      if (result.hurt) {
        this.hooks.hurt()
        this.player.knockback(hits[0]!)
        if (this.run.phase === 'lost') {
          this.finishRun()
          return
        }
      }
    }
    if (pos.y < CONFIG.run.killY) {
      const result = damage(this.run, true)
      this.run = { ...result.state, unranked: this.run.unranked }
      if (result.hurt) {
        this.hooks.hurt()
        this.player.teleport(this.player.safe)
        if (this.run.phase === 'lost') this.finishRun()
      }
    }
  }

  private finishRun(): void {
    if (this.mode !== 'playing') return
    this.mode = 'ended'
    this.hooks.end(this.run)
  }

  /** No mission compass in a free-roam garden. */
  compass(): Compass | null {
    return null
  }

  private updateSnowball(dt: number): void {
    const playerPos = this.player.root.position
    const behind = new THREE.Vector3(1.15, 0, 1.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.facing)
    const target = new THREE.Vector3(playerPos.x, 0, playerPos.z).add(behind)
    this.snowball.position.lerp(target, 1 - Math.exp(-4.5 * dt))
    const moving = Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.7
    const hop = moving ? Math.pow(Math.max(0, Math.sin(this.time * 8)), 1.6) * 0.27 : Math.abs(Math.sin(this.time * 1.8)) * 0.025
    this.snowball.position.y = hop
    this.snowball.rotation.y = this.player.facing + Math.PI
  }

  private activateLevel(level: LevelId): void {
    this.activeScene.remove(this.player.root, this.player.shadowMesh, this.snowball, this.fx.mesh)
    this.activeLevel = level
    this.activeScene = level === 'forest' ? this.forest.scene : this.world.scene
    this.activeScene.add(this.player.root, this.player.shadowMesh, this.snowball, this.fx.mesh)
    // Avoid forcing a full forest shader compile on mobile WebGL implementations.
    if (level === 'forest' && !this.renderer.isLowQuality) this.renderer.prepare(this.forest.scene, this.cam.camera)
    const spawn = level === 'forest' ? this.forest.spawn : this.world.spawn
    this.player.teleport(spawn)
    this.player.setSafePosition(spawn)
    this.player.facing = 0
    this.cam.pitch = 0.38
    this.cam.reset(spawn, 0)
    this.snowball.position.set(spawn.x + 1.2, 0, spawn.z + 1.5)
    const lantern = this.snowball.getObjectByName('Snowball lantern light')
    if (lantern) lantern.visible = level === 'forest'
    this.input.takeLook()
  }

  private handleForestInteraction(position: THREE.Vector3): void {
    const interaction = this.forest.interact(position)
    if (!interaction) return
    this.audio.play('ui')
    if (interaction === 'key-found') {
      this.hooks.quest('quest.forest.gate')
      this.hooks.popup(this.hooks.text('forest.popup.key'), this.project(this.forest.keyPosition.clone().add(new THREE.Vector3(0, 1.8, 0))), 'score')
    } else if (interaction === 'gate-locked') {
      this.hooks.popup(this.hooks.text('forest.popup.locked'), this.project(this.forest.gatePosition.clone().add(new THREE.Vector3(0, 2.8, 0))), 'score')
    } else if (interaction === 'gate-opening') {
      this.hooks.popup(this.hooks.text('forest.popup.opening'), this.project(this.forest.gatePosition.clone().add(new THREE.Vector3(0, 3.3, 0))), 'score')
    }
  }

  private readBirthdayLetter(): void {
    const wasRead = this.letterQuest === 'LETTER_READ'
    this.letterQuest = advanceLetterQuest(this.letterQuest, 'read-letter')
    if (!wasRead) this.world.markBirthdayLetterRead()
    this.hooks.quest('quest.letter.done')
    this.audio.play('ui')
    this.hooks.openLetter()
  }

  private onPlayerEvent(event: PlayerEvent, pos: THREE.Vector3): void {
    if (event.type === 'jump') {
      this.audio.play('jump')
      this.fx.puff(pos.clone().setY(0.05), 0.3)
    } else if (event.type === 'land') {
      this.audio.play('land')
      this.fx.puff(pos.clone().setY(0.05), event.impact)
    } else if (event.type === 'dash') {
      this.audio.play('dash')
    }
  }

  private setHint(hint: Hint | null): void {
    if (hint === this.lastHint) return
    this.lastHint = hint
    this.hooks.hint(hint)
  }

  private groundBelow(position: THREE.Vector3): number | null {
    this.down.origin = { x: position.x, y: position.y, z: position.z }
    const hit = this.physics.world.castRay(this.down, 30, true, undefined, undefined, this.player.collider)
    return hit ? position.y - hit.timeOfImpact : null
  }

  private project(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.cam.camera)
    const canvas = this.renderer.canvas
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight }
  }
}
