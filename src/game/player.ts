import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import { createRavenCharacter, fitCharacterModel } from './characters'
import { tuning } from './tuning'
import type { MovingPlatform } from './world'

export type PlayerIntent = { moveX: number; moveY: number; sprint: boolean; jumpPressed: boolean; jumpHeld: boolean; dashPressed: boolean }
export type PlayerEvent = { type: 'jump' } | { type: 'land'; impact: number } | { type: 'dash' }
export type RavenPose = 'standing' | 'walking' | 'running' | 'sitting'
export type RavenModels = Partial<Record<RavenPose, THREE.AnimationClip[]>>

const P = CONFIG.player
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Third-person character on Rapier's KinematicCharacterController: the controller resolves
 * collisions, slopes, steps and ground snapping; this class owns the "game feel" (acceleration,
 * coyote time, jump buffering, variable jump height, dash, moving-platform carry).
 */
export class Player {
  readonly root = new THREE.Group()
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly velocity = new THREE.Vector3()
  grounded = false
  facing = 0
  private readonly controller: RAPIER.KinematicCharacterController
  private readonly model = new THREE.Group()
  private readonly mixer?: THREE.AnimationMixer
  private readonly poseActions = new Map<RavenPose, THREE.AnimationAction>()
  private activePose?: RavenPose
  private seatedOnSwing = false
  private readonly shadow: THREE.Mesh
  private coyote = 0
  private jumpBuffer = 0
  private jumping = false
  private dashTime = 0
  private dashCooldown = 0
  private squash = 0
  private runCycle = 0
  private visualFacing = 0
  private platform?: MovingPlatform
  /** Last position where the player stood on solid, static ground (respawn point after a fall). */
  readonly safe = new THREE.Vector3()
  private safeTimer = 0

  constructor(private readonly physics: Physics, spawn: THREE.Vector3, private readonly movers: MovingPlatform[], character?: THREE.Object3D, ravenModels: RavenModels = {}) {
    const world = physics.world
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z))
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(P.halfHeight, P.radius).setFriction(0), this.body)
    this.controller = world.createCharacterController(0.02)
    this.controller.enableAutostep(0.4, 0.25, false)
    this.controller.enableSnapToGround(0.35)
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50))
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(35))
    this.controller.setApplyImpulsesToDynamicBodies(true)
    this.safe.copy(spawn)

    this.root.position.copy(spawn)
    const fallback = character ?? createRavenCharacter()
    const fittedCharacter = fitCharacterModel(fallback, 2, 'center')
    const visibleCharacter = fittedCharacter.children.length > 0 ? fittedCharacter : fitCharacterModel(createRavenCharacter(), 2, 'center')
    this.model.add(visibleCharacter)
    if (Object.values(ravenModels).some(clips => clips && clips.length > 0)) {
      this.mixer = new THREE.AnimationMixer(visibleCharacter)
      for (const pose of ['standing', 'walking', 'running', 'sitting'] as RavenPose[]) {
        const clip = ravenModels[pose]?.[0]
        if (clip) this.poseActions.set(pose, this.mixer.clipAction(clip))
      }
    }
    this.model.rotation.order = 'YXZ'
    this.root.add(this.model)
    physics.bind(this.body, this.root)

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(P.radius * 1.25, 24),
      new THREE.MeshBasicMaterial({ color: '#1d1a2a', transparent: true, opacity: 0.35, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 1
  }

  get shadowMesh(): THREE.Mesh {
    return this.shadow
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y, t.z)
  }

  get dashing(): boolean {
    return this.dashTime > 0
  }

  get isSeatedOnSwing(): boolean {
    return this.seatedOnSwing
  }

  sitOnSwing(position: THREE.Vector3, facing: number): void {
    this.seatedOnSwing = true
    this.body.setTranslation(position, true)
    this.body.setNextKinematicTranslation(position)
    this.root.position.copy(position)
    this.velocity.set(0, 0, 0)
    this.facing = facing
    this.setPose('sitting')
    this.physics.snap(this.body)
  }

  standFromSwing(): void {
    this.seatedOnSwing = false
    this.setPose('standing')
  }

  followSwing(position: THREE.Vector3): void {
    if (!this.seatedOnSwing) return
    this.body.setTranslation(position, true)
    this.body.setNextKinematicTranslation(position)
    this.root.position.copy(position)
    this.physics.snap(this.body)
  }

  setPose(pose: RavenPose): void {
    const next = this.poseActions.get(pose)
    if (!next || this.activePose === pose) return
    this.activePose = pose
    for (const action of this.poseActions.values()) {
      if (action !== next) {
        action.fadeOut(0.12)
        action.paused = false
      }
    }
    next.reset().fadeIn(0.12).play()
    if (pose === 'standing') {
      // The supplied idle clip includes a foot-shifting loop. Keep Raven planted when
      // there is no movement input; locomotion clips remain fully animated.
      next.paused = true
    }
  }

  /** Keep the avatar oriented with the mouse-controlled camera, independent of movement input. */
  setFacing(yaw: number): void {
    this.facing = yaw
  }

  /** One fixed step. `cameraYaw` makes stick/WASD movement camera-relative. */
  step(dt: number, intent: PlayerIntent, cameraYaw: number, events: PlayerEvent[]): void {
    if (this.seatedOnSwing) return
    const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw))
    const right = new THREE.Vector3().crossVectors(forward, UP)
    const wish = new THREE.Vector3().addScaledVector(right, intent.moveX).addScaledVector(forward, intent.moveY)
    const wishLen = Math.min(1, wish.length())
    if (wishLen > 0.01) wish.normalize()

    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt)
    this.jumpBuffer = intent.jumpPressed ? P.jumpBuffer : Math.max(0, this.jumpBuffer - dt)
    this.dashCooldown = Math.max(0, this.dashCooldown - dt)

    if (intent.dashPressed && this.dashCooldown <= 0) {
      tuning.activate('dash')
      const dir = wishLen > 0.01 ? wish : new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing))
      this.velocity.set(dir.x * P.dashSpeed, Math.max(this.velocity.y, 0), dir.z * P.dashSpeed)
      this.dashTime = P.dashTime
      this.dashCooldown = P.dashCooldown
      events.push({ type: 'dash' })
    }

    if (this.dashTime > 0) {
      this.dashTime -= dt
      this.velocity.y = Math.max(this.velocity.y, 0)
    } else {
      const speed = (intent.sprint ? P.sprintSpeed : P.walkSpeed) * wishLen
      const control = this.grounded ? 1 : P.airControl
      const target = wish.clone().multiplyScalar(speed)
      const horizontal = new THREE.Vector3(this.velocity.x, 0, this.velocity.z)
      horizontal.lerp(target, 1 - Math.exp(-(P.acceleration / 6) * control * dt))
      this.velocity.x = horizontal.x
      this.velocity.z = horizontal.z

      if (this.jumpBuffer > 0 && this.coyote > 0) {
        tuning.activate('jump')
        this.velocity.y = P.jumpSpeed
        this.jumping = true
        this.jumpBuffer = 0
        this.coyote = 0
        this.grounded = false
        this.platform = undefined
        this.squash = -0.35
        events.push({ type: 'jump' })
      }
      const rising = this.velocity.y > 0
      const gravity = rising && this.jumping && !intent.jumpHeld ? P.lowJumpGravity : P.gravity
      this.velocity.y = Math.max(P.maxFall, this.velocity.y + gravity * dt)
    }

    const desired = this.velocity.clone().multiplyScalar(dt)
    if (this.platform) desired.add(this.platform.delta)
    this.controller.computeColliderMovement(this.collider, desired)
    const moved = this.controller.computedMovement()
    const wasGrounded = this.grounded
    this.grounded = this.controller.computedGrounded()

    // Bumped a ceiling: stop rising. Hit a wall mid-dash: end the dash.
    if (this.velocity.y > 0 && moved.y < desired.y - 1e-3) this.velocity.y = 0
    if (this.grounded) {
      if (!wasGrounded && this.velocity.y < -6) {
        events.push({ type: 'land', impact: Math.min(1, -this.velocity.y / 30) })
        this.squash = Math.min(0.45, -this.velocity.y / 60)
      }
      if (this.velocity.y < 0) this.velocity.y = -1
      this.jumping = false
    }

    const cur = this.body.translation()
    const next = { x: cur.x + moved.x, y: cur.y + moved.y, z: cur.z + moved.z }
    this.body.setNextKinematicTranslation(next)
    this.platform = this.grounded ? this.findPlatform(next) : undefined

    if (this.grounded && !this.platform) {
      this.safeTimer += dt
      if (this.safeTimer > 0.4) this.safe.set(next.x, next.y + 0.2, next.z)
    } else {
      this.safeTimer = 0
    }
  }

  private findPlatform(pos: { x: number; y: number; z: number }): MovingPlatform | undefined {
    const feet = pos.y - P.halfHeight - P.radius
    return this.movers.find(m => {
      const c = m.body.translation()
      const top = c.y + m.half.y
      return Math.abs(feet - top) < 0.2 && Math.abs(pos.x - c.x) < m.half.x + P.radius * 0.6 && Math.abs(pos.z - c.z) < m.half.z + P.radius * 0.6
    })
  }

  /** Teleport (respawn). Clears velocity and interpolation so the camera does not streak. */
  teleport(to: THREE.Vector3): void {
    this.body.setTranslation(to, true)
    this.body.setNextKinematicTranslation(to)
    this.velocity.set(0, 0, 0)
    this.platform = undefined
    this.dashTime = 0
    this.root.position.copy(to)
    this.physics.snap(this.body)
  }

  setSafePosition(to: THREE.Vector3): void {
    this.safe.copy(to)
    this.safeTimer = 0
  }

  /** Knock the player away from a hazard. */
  knockback(from: THREE.Vector3): void {
    const away = this.position.sub(from).setY(0)
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0)
    away.normalize().multiplyScalar(9)
    this.velocity.set(away.x, 7, away.z)
    this.dashTime = 0
    this.grounded = false
    this.platform = undefined
  }

  /** Visual-only animation, once per rendered frame after `physics.sync()`. */
  animate(frameSeconds: number, time: number, invulnerable: boolean, ground: number | null): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    if (this.seatedOnSwing) this.setPose('sitting')
    else if (this.grounded && speed > 0.5) this.setPose(speed > P.walkSpeed * 0.82 ? 'running' : 'walking')
    else this.setPose('standing')
    this.mixer?.update(frameSeconds)
    this.visualFacing = dampAngle(this.visualFacing, this.facing, 18, frameSeconds)
    this.model.rotation.y = this.visualFacing + (this.seatedOnSwing ? 0 : Math.PI)
    this.squash = THREE.MathUtils.damp(this.squash, 0, 10, frameSeconds)
    const stretch = this.grounded ? 0 : THREE.MathUtils.clamp(this.velocity.y / 60, -0.12, 0.18)
    const s = 1 - this.squash + stretch
    this.model.scale.set(1 / Math.sqrt(Math.max(s, 0.5)), s, 1 / Math.sqrt(Math.max(s, 0.5)))
    if (this.grounded && speed > 0.5) this.runCycle += frameSeconds * speed * 1.6
    const bob = this.grounded ? Math.abs(Math.sin(this.runCycle)) * 0.08 * Math.min(1, speed / 6) : 0
    this.model.position.y = bob
    this.model.rotation.x = -Math.min(0.28, speed / 40) * (this.dashing ? 1.6 : 1)
    this.model.visible = !invulnerable || Math.floor(time * 16) % 2 === 0

    // Blob shadow: always-on depth cue for platforming, even with real shadows disabled.
    if (ground === null) {
      this.shadow.visible = false
    } else {
      const feet = this.root.position.y - P.halfHeight - P.radius
      const height = Math.max(0, feet - ground)
      this.shadow.visible = height < 14
      this.shadow.position.set(this.root.position.x, ground + 0.03, this.root.position.z)
      const k = THREE.MathUtils.clamp(1 - height / 14, 0.25, 1)
      this.shadow.scale.setScalar(k)
      ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.38 * k
    }
  }
}

function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * (1 - Math.exp(-lambda * dt))
}
