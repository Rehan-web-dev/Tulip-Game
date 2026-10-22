import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { createBeastBoy, createGardenBunny, fitCharacterModel } from './characters'
import { Collectibles } from './collectibles'
import { Drones } from './drones'

export type MovingPlatform = {
  mesh: THREE.Mesh
  body: RAPIER.RigidBody
  from: THREE.Vector3
  to: THREE.Vector3
  period: number
  phase: number
  delta: THREE.Vector3
  half: THREE.Vector3
}

export type DroneRoute = { center: THREE.Vector3; radius: number; phase: number; dir: 1 | -1 }
type GardenRabbit = { root: THREE.Group; heart: THREE.Sprite; baseScale: number; x: number; z: number; phase: number; speed: number; radius: number; fedUntil: number; nextFeedAt: number }
export type TulipPlacement = { x: number; z: number; rotation: number; scale: number; color: number }
type InstanceSlot = { mesh: THREE.InstancedMesh; index: number }
type PickableTulip = { position: THREE.Vector3; placement: TulipPlacement; slots: InstanceSlot[]; picked: boolean }
type FallingLeaf = { mesh: THREE.Mesh; origin: THREE.Vector3; phase: number; speed: number; material: THREE.MeshStandardMaterial }

const GARDEN_PATHS = [
  { x: 0, z: -3, width: 4.5, length: 34, angle: 0 },
  { x: -8, z: -7.5, width: 3.2, length: 19, angle: -0.72 },
  { x: 9, z: 0.5, width: 3.2, length: 18, angle: 0.78 },
  { x: 0, z: 18, width: 3.6, length: 14, angle: 0 },
] as const
const FLOWER_PATH_MARGIN = 0.9
const GARDEN_FLOWER_COLORS = ['#ff688c', '#ffb72f', '#fff08e', '#b674f4', '#f3525e', '#ff82b3', '#7866fa']

/** Includes a small border around each walkable slab so blossoms do not crowd the path edges. */
export function isOnGardenPath(x: number, z: number, margin = FLOWER_PATH_MARGIN): boolean {
  return GARDEN_PATHS.some(path => {
    const dx = x - path.x
    const dz = z - path.z
    const cos = Math.cos(path.angle)
    const sin = Math.sin(path.angle)
    const localX = cos * dx - sin * dz
    const localZ = sin * dx + cos * dz
    return Math.abs(localX) <= path.width * 0.5 + margin && Math.abs(localZ) <= path.length * 0.5 + margin
  })
}

/** Generate the same number of flowers on either side while avoiding the house, paths, sign, and swing clearing. */
export function generateTulipPlacements(random: () => number, perSideCount: number): TulipPlacement[] {
  const placements: TulipPlacement[] = []
  const sides: ReadonlyArray<readonly [number, number]> = [[-32, -3.75], [3.75, 32]]
  for (const [minX, maxX] of sides) {
    let placed = 0
    let attempts = 0
    while (placed < perSideCount && attempts < perSideCount * 12) {
      attempts += 1
      const x = minX + random() * (maxX - minX)
      const z = -28 + random() * 56
      const inHouse = Math.abs(x) < 6.7 && z > -31 && z < -14
      const nearWelcomeSign = Math.hypot(x - 8.2, z - 18) < 2.6
      const inSwingClearing = Math.hypot(x - 10.2, z + 21.8) < 6
      if (inHouse || nearWelcomeSign || inSwingClearing || isOnGardenPath(x, z)) continue
      placements.push({
        x,
        z,
        rotation: random() * Math.PI * 2,
        scale: 0.84 + random() * 0.34,
        color: Math.floor(random() * GARDEN_FLOWER_COLORS.length),
      })
      placed += 1
    }
  }
  return placements
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, position: [number, number, number], scale?: [number, number, number]): THREE.Mesh {
  const out = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }))
  out.position.set(...position)
  if (scale) out.scale.set(...scale)
  out.castShadow = true
  out.receiveShadow = true
  return out
}

/** A small open garden world: walkable lawn, winding path, cottage, tulip beds and hopping rabbits. */
export class World {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  readonly spawn = new THREE.Vector3(0, 1.1, 13)
  readonly movers: MovingPlatform[] = []
  readonly droneRoutes: DroneRoute[] = [
    { center: new THREE.Vector3(-17, 2.2, 8), radius: 5.5, phase: 0, dir: 1 },
    { center: new THREE.Vector3(18, 2.6, -5), radius: 6.5, phase: Math.PI, dir: -1 },
    { center: new THREE.Vector3(0, 1.8, 25), radius: 4.2, phase: Math.PI / 2, dir: 1 },
  ]
  readonly collectibles: Collectibles
  readonly drones: Drones
  readonly npcPosition = new THREE.Vector3(-8, 0, -8)
  readonly npc: THREE.Group
  readonly rabbits: GardenRabbit[] = []
  private readonly pickableTulips: PickableTulip[] = []
  private elapsed = 0
  private droneRage = false
  private flowerCount = 0
  private readonly nightSky: THREE.Group
  readonly birthdayLetterPosition = new THREE.Vector3(-0.72, 0, -22.85)
  private houseRoof: THREE.Group | undefined
  private birthdayLetter: THREE.Group | undefined
  private letterMarker: THREE.Group | undefined
  private letterLight: THREE.PointLight | undefined
  private readonly candleFlames: { mesh: THREE.Mesh; light: THREE.PointLight }[] = []
  private readonly swingPivot = new THREE.Group()
  private swingOccupied = false
  private readonly fallingLeaves: FallingLeaf[] = []
  private readonly houseDoor = new THREE.Group()
  private houseDoorCollider: ReturnType<Physics['addStaticBox']> | undefined
  private houseDoorOpen = false
  private houseDoorTarget = 0
  private houseDoorWasInside = false
  readonly swingSeatPosition = new THREE.Vector3(7.65, 1.95, -21.62)

  constructor(private readonly physics: Physics, shadowMapSize: number, beastBoyModel?: THREE.Object3D, tulipModel?: THREE.Object3D) {
    const random = seeded(240816)
    this.scene.background = new THREE.Color('#080d21')
    this.scene.fog = new THREE.Fog('#172541', 76, 158)
    this.scene.add(new THREE.HemisphereLight('#8fa7df', '#202a34', 0.92))
    this.sun = new THREE.DirectionalLight('#c4d3ff', 1.22)
    this.sun.position.set(-18, 34, 12)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -42
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 42
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 100
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun, this.sun.target)
    this.nightSky = this.makeNightSky(seeded(9072026))
    this.scene.add(this.nightSky)

    this.makeGround()
    this.makePath()
    this.makeHouse()
    this.scene.userData.houseCount = 1
    this.makeAutumnTree(seeded(101023))
    this.makeFlowerBeds(random, tulipModel)
    this.makeTrees(random)
    this.makeBoundary(random)
    this.makeWelcomeSign()
    this.makeRabbits(random)
    this.collectibles = new Collectibles([
      new THREE.Vector3(-22, 1.4, 8),
      new THREE.Vector3(-14, 1.4, 25),
      new THREE.Vector3(-2, 1.4, 34),
      new THREE.Vector3(13, 1.4, 28),
      new THREE.Vector3(25, 1.4, 15),
      new THREE.Vector3(30, 1.4, -10),
      new THREE.Vector3(16, 1.4, -25),
      new THREE.Vector3(-18, 1.4, -30),
    ])
    this.scene.add(this.collectibles.group)
    this.drones = new Drones(physics, this.droneRoutes)
    this.scene.add(this.drones.group)

    this.npc = beastBoyModel ? fitCharacterModel(beastBoyModel, 1.85, 'floor') : createBeastBoy()
    this.npc.position.copy(this.npcPosition)
    this.npc.rotation.y = Math.PI
    this.scene.add(this.npc)
    const label = this.makeNameTag('BEAST BOY')
    label.position.set(0, 2.1, 0)
    this.npc.add(label)
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.elapsed += dt
    this.collectibles.animate(dt)
    this.drones.animate(dt, this.droneRage)
    const insideHouse = Math.abs(focus.x) < 4.55 && focus.z > -26.5 && focus.z < -19.55
    if (insideHouse && !this.houseDoorWasInside && this.houseDoorOpen) this.toggleHouseDoor()
    this.houseDoorWasInside = insideHouse
    // Keep the roof stable while crossing the doorway. Toggling the whole roof at the
    // threshold caused a visible pop and exposed the sky through the cottage.
    if (this.houseRoof) this.houseRoof.visible = true
    this.scene.userData.houseInteriorActive = insideHouse
    const swingSpeed = this.swingOccupied ? 1.35 : 1.15
    const swingAmplitude = this.swingOccupied ? 0.075 : 0.065
    this.swingPivot.rotation.x = Math.sin(this.elapsed * swingSpeed) * swingAmplitude
    for (const leaf of this.fallingLeaves) {
      const cycle = (this.elapsed * leaf.speed + leaf.phase * 4.5) % 9.2
      const falling = cycle < 3.2
      const fallProgress = Math.min(1, cycle / 3.2)
      const fadeProgress = cycle > 7.7 ? (cycle - 7.7) / 1.5 : 0
      leaf.mesh.position.set(
        falling ? leaf.origin.x + Math.sin(this.elapsed * 1.7 + leaf.phase) * 0.7 * fallProgress : leaf.origin.x,
        falling ? leaf.origin.y - 8.5 * fallProgress * fallProgress : 0.08,
        falling ? leaf.origin.z + Math.cos(this.elapsed * 1.3 + leaf.phase) * 0.55 * fallProgress : leaf.origin.z,
      )
      leaf.mesh.visible = cycle < 9.2
      leaf.material.opacity = fadeProgress > 0 ? 1 - fadeProgress : 1
      if (falling) {
        leaf.mesh.rotation.x += dt * 2.2
        leaf.mesh.rotation.y += dt * 1.7
        leaf.mesh.rotation.z += dt * 1.1
      } else if (cycle > 1.28) {
        leaf.mesh.visible = false
      }
    }
    if (this.birthdayLetter) this.birthdayLetter.rotation.z = Math.sin(this.elapsed * 1.4) * 0.025
    if (this.letterMarker) this.letterMarker.position.y = (this.scene.userData.birthdayLetterRead ? 1.45 : 1.5) + Math.sin(this.elapsed * 2.4) * 0.055
    this.candleFlames.forEach(({ mesh: flame, light }, index) => {
      const flicker = Math.sin(this.elapsed * 7.8 + index * 1.7)
      flame.scale.y = 0.85 + flicker * 0.13
      light.intensity = 0.3 + (flicker + 1) * 0.08
    })
    if (this.letterLight) this.letterLight.intensity = this.scene.userData.birthdayLetterRead ? 0.2 : 0.5 + Math.sin(this.elapsed * 2.8) * 0.12
    this.sun.position.set(focus.x - 18, focus.y + 34, focus.z + 12)
    this.sun.target.position.copy(focus)
    this.nightSky.position.set(focus.x, 0, focus.z)
    this.npc.position.y = Math.sin(this.elapsed * 2.1) * 0.035
    this.houseDoor.rotation.y += (this.houseDoorTarget - this.houseDoor.rotation.y) * Math.min(1, dt * 8)
    for (const bunny of this.rabbits) {
      const t = this.elapsed * bunny.speed + bunny.phase
      const fed = this.elapsed < bunny.fedUntil
      const hop = Math.pow(Math.max(0, Math.sin(t * 2.7)), 1.4) * 0.32
      bunny.root.position.set(bunny.x + Math.sin(t * 0.36) * bunny.radius, hop + (fed ? 0.035 + Math.abs(Math.sin(this.elapsed * 14)) * 0.035 : 0), bunny.z + Math.cos(t * 0.36) * bunny.radius)
      bunny.root.rotation.y = Math.atan2(Math.cos(t * 0.36), -Math.sin(t * 0.36))
      bunny.root.rotation.x = fed ? Math.sin(this.elapsed * 14) * 0.12 : Math.sin(t * 2.7) * 0.08
      bunny.root.scale.setScalar(bunny.baseScale * (fed ? 1 + Math.max(0, Math.sin(this.elapsed * 8)) * 0.045 : 1))
      bunny.heart.visible = fed
      bunny.heart.position.y = 1.4 + (fed ? Math.sin(this.elapsed * 5) * 0.08 : 0)
    }
  }

  /** Advance garden hazards before the physics step. */
  stepMovers(dt: number, rage = false): void {
    this.droneRage = rage
    this.drones.step(dt, rage)
  }

  nearestPickableTulip(position: THREE.Vector3, maxDistance: number): PickableTulip | undefined {
    let closest: PickableTulip | undefined
    let closestDistance = maxDistance
    for (const tulip of this.pickableTulips) {
      if (tulip.picked) continue
      const distance = Math.hypot(position.x - tulip.position.x, position.z - tulip.position.z)
      if (distance < closestDistance) {
        closest = tulip
        closestDistance = distance
      }
    }
    return closest
  }

  pickTulip(tulip: PickableTulip): boolean {
    if (tulip.picked || tulip.slots.length === 0) return false
    tulip.picked = true
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const changed = new Set<THREE.InstancedMesh>()
    for (const slot of tulip.slots) {
      slot.mesh.setMatrixAt(slot.index, hidden)
      changed.add(slot.mesh)
    }
    for (const instance of changed) instance.instanceMatrix.needsUpdate = true
    this.scene.userData.tulipsPicked = (this.scene.userData.tulipsPicked ?? 0) + 1
    this.scene.userData.pickableTulipsRemaining = this.pickableTulips.filter(item => !item.picked).length
    return true
  }

  nearestFeedableBunny(position: THREE.Vector3, maxDistance: number): GardenRabbit | undefined {
    let closest: GardenRabbit | undefined
    let closestDistance = maxDistance
    for (const bunny of this.rabbits) {
      if (this.elapsed < bunny.nextFeedAt) continue
      const distance = Math.hypot(position.x - bunny.root.position.x, position.z - bunny.root.position.z)
      if (distance < closestDistance) {
        closest = bunny
        closestDistance = distance
      }
    }
    return closest
  }

  feedBunny(bunny: GardenRabbit): boolean {
    if (this.elapsed < bunny.nextFeedAt) return false
    bunny.fedUntil = this.elapsed + 3.2
    bunny.nextFeedAt = this.elapsed + 7
    this.scene.userData.bunniesFed = (this.scene.userData.bunniesFed ?? 0) + 1
    return true
  }

  isNearBirthdayLetter(position: THREE.Vector3, maxDistance: number): boolean {
    return Math.hypot(position.x - this.birthdayLetterPosition.x, position.z - this.birthdayLetterPosition.z) < maxDistance
  }

  isNearHouseDoor(position: THREE.Vector3, maxDistance: number): boolean {
    return Math.hypot(position.x, position.z - (-18.95)) < maxDistance
  }

  toggleHouseDoor(): boolean {
    this.houseDoorOpen = !this.houseDoorOpen
    this.houseDoorTarget = this.houseDoorOpen ? -Math.PI * 0.52 : 0
    if (this.houseDoorOpen) {
      if (this.houseDoorCollider) {
        this.physics.world.removeCollider(this.houseDoorCollider, true)
        this.houseDoorCollider = undefined
      }
    } else {
      this.houseDoorCollider = this.physics.addStaticBox(
        new THREE.Vector3(0, 1.45, -18.96),
        new THREE.Vector3(1.8, 2.8, 0.3),
      )
    }
    this.scene.userData.houseDoorOpen = this.houseDoorOpen
    return this.houseDoorOpen
  }

  isNearBoundary(position: THREE.Vector3): boolean {
    return Math.abs(position.x) > 39.5 || Math.abs(position.z) > 39.5
  }

  getSwingSeatPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const swingAngle = this.swingPivot.rotation.x
    target.set(7.65, 1.12, -21.62)
    target.y += 6.28 * (1 - Math.cos(swingAngle)) + 0.83
    target.z += -6.28 * Math.sin(swingAngle)
    return target
  }

  setSwingOccupied(occupied: boolean): void {
    this.swingOccupied = occupied
  }

  markBirthdayLetterRead(): void {
    this.scene.userData.birthdayLetterRead = true
    if (this.letterMarker) this.letterMarker.visible = false
    if (this.letterLight) this.letterLight.intensity = 0.2
  }

  resetBirthdayLetter(): void {
    this.scene.userData.birthdayLetterRead = false
    if (this.letterMarker) this.letterMarker.visible = true
    if (this.letterLight) this.letterLight.intensity = 0.5
  }

  resetRun(): void {
    this.collectibles.reset()
    this.droneRage = false
    if (this.houseDoorOpen) this.toggleHouseDoor()
    this.houseDoorWasInside = false
    this.scene.userData.collectiblesRemaining = this.collectibles.total
  }

  private makeNightSky(random: () => number): THREE.Group {
    const sky = new THREE.Group()
    const radius = 150
    const domeGeometry = new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5)
    const positions = domeGeometry.getAttribute('position')
    const vertexColors: number[] = []
    const horizon = new THREE.Color('#26375f')
    const zenith = new THREE.Color('#080d21')
    const color = new THREE.Color()
    for (let i = 0; i < positions.count; i += 1) {
      const elevation = THREE.MathUtils.clamp(positions.getY(i) / radius, 0, 1)
      color.copy(horizon).lerp(zenith, Math.pow(elevation, 0.56))
      vertexColors.push(color.r, color.g, color.b)
    }
    domeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3))
    const dome = new THREE.Mesh(domeGeometry, new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }))
    dome.renderOrder = -30
    dome.frustumCulled = false
    sky.add(dome)

    const starShape = new THREE.Shape()
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 5
      const point = i % 2 === 0 ? 1 : 0.43
      const x = Math.cos(angle) * point
      const y = Math.sin(angle) * point
      if (i === 0) starShape.moveTo(x, y)
      else starShape.lineTo(x, y)
    }
    starShape.closePath()
    const starGeometry = new THREE.ShapeGeometry(starShape)
    const starCount = 144
    const starColor = '#ffd54a'
    const starMinScale = 1
    const starMaxScale = 1.65
    const stars = new THREE.InstancedMesh(starGeometry, new THREE.MeshBasicMaterial({
      color: starColor,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }), starCount)
    stars.name = 'Five-point yellow stars'
    const dummy = new THREE.Object3D()
    const normal = new THREE.Vector3()
    const spin = new THREE.Quaternion()
    for (let i = 0; i < starCount; i += 1) {
      const azimuth = random() * Math.PI * 2
      const elevation = (0.08 + random() * 0.88) * Math.PI * 0.5
      const distance = 108 + random() * 10
      dummy.position.set(
        Math.cos(elevation) * Math.cos(azimuth) * distance,
        Math.sin(elevation) * distance,
        Math.cos(elevation) * Math.sin(azimuth) * distance,
      )
      normal.copy(dummy.position).normalize().negate()
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
      spin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), random() * Math.PI * 2)
      dummy.quaternion.multiply(spin)
      const size = starMinScale + random() * (starMaxScale - starMinScale)
      dummy.scale.setScalar(size)
      dummy.updateMatrix()
      stars.setMatrixAt(i, dummy.matrix)
      stars.setColorAt(i, new THREE.Color(starColor))
    }
    stars.instanceMatrix.needsUpdate = true
    if (stars.instanceColor) stars.instanceColor.needsUpdate = true
    stars.renderOrder = -20
    stars.frustumCulled = false
    sky.add(stars)
    this.scene.userData.starColor = starColor
    this.scene.userData.starMinScale = starMinScale
    this.scene.userData.starMaxScale = starMaxScale

    const dots = new THREE.BufferGeometry()
    const dotPositions: number[] = []
    for (let i = 0; i < 180; i += 1) {
      const azimuth = random() * Math.PI * 2
      const elevation = (0.04 + random() * 0.93) * Math.PI * 0.5
      const distance = 112
      dotPositions.push(
        Math.cos(elevation) * Math.cos(azimuth) * distance,
        Math.sin(elevation) * distance,
        Math.cos(elevation) * Math.sin(azimuth) * distance,
      )
    }
    dots.setAttribute('position', new THREE.Float32BufferAttribute(dotPositions, 3))
    const pinpricks = new THREE.Points(dots, new THREE.PointsMaterial({
      color: '#fff0a6',
      size: 1.55,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }))
    pinpricks.renderOrder = -21
    pinpricks.frustumCulled = false
    sky.add(pinpricks)
    this.scene.userData.skyTheme = 'night'
    this.scene.userData.starShapeCount = starCount
    return sky
  }

  private makeGround(): void {
    const ground = mesh(new THREE.PlaneGeometry(100, 100), '#5f9561', [0, -0.12, 0])
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)
    this.physics.addStaticBox(new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(100, 0.5, 100))

    const clearings = [
      { x: -22, z: -2, r: 13, c: '#6fa66a' }, { x: 22, z: 2, r: 13, c: '#6aa267' },
      { x: 0, z: 29, r: 12, c: '#70a96b' }, { x: -27, z: -27, r: 9, c: '#60955d' },
      { x: 28, z: -27, r: 9, c: '#649a60' },
    ]
    for (const p of clearings) {
      const patch = mesh(new THREE.CircleGeometry(p.r, 40), p.c, [p.x, -0.085, p.z])
      patch.rotation.x = -Math.PI / 2
      patch.receiveShadow = true
      this.scene.add(patch)
    }

    for (const [x, z, s] of [[-45, -39, 16], [-34, 45, 20], [48, 42, 18], [46, -28, 15], [0, 55, 24], [-57, 4, 22], [60, 7, 20]] as const) {
      const hill = mesh(new THREE.SphereGeometry(1, 18, 12), '#557f60', [x, -2.2, z], [s, 8, s * 0.72])
      hill.castShadow = false
      this.scene.add(hill)
    }
    this.makeGrass()
  }

  private makeGrass(): void {
    const random = seeded(483921)
    const bladeGeometry = new THREE.ConeGeometry(0.045, 0.42, 3)
    const materials = ['#3f764b', '#4f8952', '#679b59'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }))
    const blades = materials.map(material => new THREE.InstancedMesh(bladeGeometry, material, 420))
    const dummy = new THREE.Object3D()
    const base = new THREE.Vector3()
    for (let i = 0; i < 1260; i += 1) {
      const x = -47 + random() * 94
      const z = -47 + random() * 94
      if (isOnGardenPath(x, z, 0.45) || (Math.abs(x) < 7.5 && z > -32 && z < -14)) continue
      const cluster = i % 3
      base.set(x, 0.18, z)
      dummy.position.copy(base)
      dummy.rotation.set((random() - 0.5) * 0.25, random() * Math.PI * 2, (random() - 0.5) * 0.25)
      dummy.scale.set(0.8 + random() * 0.6, 0.7 + random() * 0.8, 0.8 + random() * 0.6)
      dummy.updateMatrix()
      blades[cluster]!.setMatrixAt(Math.floor(i / 3), dummy.matrix)
    }
    for (const [index, mesh] of blades.entries()) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.name = `Garden grass blades ${index + 1}`
      this.scene.add(mesh)
    }
  }

  private makePath(): void {
    const pathMat = new THREE.MeshStandardMaterial({ color: '#dbc59a', roughness: 1 })
    const add = (x: number, z: number, width: number, length: number, angle = 0) => {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, length), pathMat)
      slab.position.set(x, -0.015, z)
      slab.rotation.y = angle
      slab.receiveShadow = true
      this.scene.add(slab)
    }
    add(0, -3, 4.5, 34)
    add(-8, -7.5, 3.2, 19, -0.72)
    add(9, 0.5, 3.2, 18, 0.78)
    add(0, 18, 3.6, 14)
    // Small stepping stones create a friendly path texture without blocking movement.
    const stoneMat = new THREE.MeshStandardMaterial({ color: '#eee0c4', roughness: 1 })
    for (let i = 0; i < 20; i += 1) {
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.62, 0.08, 7), stoneMat)
      stone.position.set((i % 2 ? 0.16 : -0.16), 0.045, 12 - i * 1.45)
      stone.rotation.y = i * 0.73
      stone.receiveShadow = true
      this.scene.add(stone)
    }
  }

  private makeHouse(): void {
    const wall = new THREE.MeshStandardMaterial({ color: '#fff1d9', roughness: 0.92 })
    const trim = new THREE.MeshStandardMaterial({ color: '#be715e', roughness: 0.86 })
    const roof = new THREE.MeshStandardMaterial({ color: '#a64c57', roughness: 0.9 })
    const doorWood = new THREE.MeshStandardMaterial({ color: '#8e5842', roughness: 0.86 })
    const doorTrim = new THREE.MeshStandardMaterial({ color: '#f0bd72', roughness: 0.68 })
    const wreathGreen = new THREE.MeshStandardMaterial({ color: '#4d8c55', roughness: 0.9 })
    const wreathFlower = new THREE.MeshStandardMaterial({ color: '#ef7898', roughness: 0.72 })
    const glass = new THREE.MeshStandardMaterial({ color: '#ffe4a1', emissive: '#ff9d35', emissiveIntensity: 1.15, roughness: 0.35, metalness: 0.05 })
    const cx = 0, cz = -23
    let solidWallColliderCount = 0
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.24, 8), new THREE.MeshStandardMaterial({ color: '#d3b88c', roughness: 1 }))
    floor.position.set(cx, -0.02, cz)
    floor.receiveShadow = true
    this.scene.add(floor)
    this.physics.addStaticBox(new THREE.Vector3(cx, -0.02, cz), new THREE.Vector3(10, 0.24, 8))

    const wallBox = (x: number, y: number, z: number, w: number, h: number, d: number, collidable = true, material = wall) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
      if (collidable) {
        this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w, h, d))
        if (material === wall) solidWallColliderCount += 1
      }
      return m
    }
    // The front is split around a wide open doorway so the player can wander inside.
    wallBox(cx - 4.88, 1.75, cz, 0.24, 3.5, 8, true)
    wallBox(cx + 4.88, 1.75, cz, 0.24, 3.5, 8, true)
    wallBox(cx, 1.75, cz - 3.88, 9.5, 3.5, 0.24, true)
    // Match the wall opening to the actual door so there are no oversized gaps on either side.
    wallBox(cx - 3.0, 1.75, cz + 3.88, 3.8, 3.5, 0.24, true)
    wallBox(cx + 3.0, 1.75, cz + 3.88, 3.8, 3.5, 0.24, true)
    wallBox(cx, 3.25, cz + 3.88, 2.2, 0.45, 0.24, true)

    // Use two solid planes instead of a four-sided cone. The cone left gaps above the
    // front wall from some camera angles, making the roof appear to flicker or float.
    const roofGroup = new THREE.Group()
    roofGroup.name = 'Cottage gabled roof'
    const roofAngle = Math.atan2(2.35, 4.25)
    const roofPanel = (z: number, angle: number) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.22, 4.86), roof)
      panel.position.set(cx, 4.65, cz + z)
      panel.rotation.x = angle
      panel.castShadow = true
      panel.receiveShadow = true
      roofGroup.add(panel)
    }
    roofPanel(-2.05, -roofAngle)
    roofPanel(2.05, roofAngle)
    roofGroup.position.y = 0.1
    this.scene.add(roofGroup)
    this.houseRoof = roofGroup
    wallBox(cx + 3.2, 5.1, cz - 2.4, 0.8, 2.5, 0.8, false, trim)
    this.houseDoor.position.set(cx - 0.9, 0, cz + 4.04)
    this.houseDoor.name = 'Animated cottage front door'
    this.scene.add(this.houseDoor)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, 0.16), doorWood)
    door.position.set(0.9, 1.45, 0)
    door.castShadow = true
    door.receiveShadow = true
    this.houseDoor.add(door)
    door.name = 'Decorated cottage front door'
    for (const y of [0.55, 1.2, 1.85, 2.5]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.045, 0.035), doorTrim)
      plank.position.set(0.9, y, 0.11)
      this.houseDoor.add(plank)
    }
    for (const x of [-0.92, 0.92]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.12, 0.22), doorTrim)
      post.position.set(cx + x, 1.5, cz + 4.16)
      this.scene.add(post)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.2, 0.22), doorTrim)
    lintel.position.set(cx, 3.04, cz + 4.16)
    this.scene.add(lintel)
    const doorKnob = mesh(new THREE.SphereGeometry(0.075, 8, 6), '#e4bb57', [0.62, 1.45, cz + 4.18])
    doorKnob.position.set(0.62 + 0.9, 1.45, 0.14)
    this.houseDoor.add(doorKnob)
    const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.095, 8, 18), wreathGreen)
    wreath.position.set(0.9, 2.18, 0.16)
    this.houseDoor.add(wreath)
    for (let i = 0; i < 6; i += 1) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), wreathFlower)
      const angle = i / 6 * Math.PI * 2
      flower.position.set(0.9 + Math.cos(angle) * 0.42, 2.18 + Math.sin(angle) * 0.42, 0.18)
      this.houseDoor.add(flower)
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 1.15), roof)
    canopy.position.set(cx, 3.25, cz + 4.42)
    canopy.rotation.x = -0.16
    canopy.castShadow = true
    this.scene.add(canopy)
    for (const x of [-1.05, 1.05]) {
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 0.2), doorTrim)
      lantern.position.set(cx + x, 2.82, cz + 4.3)
      this.scene.add(lantern)
      const light = new THREE.PointLight('#ffc56d', 0.48, 4.5, 2)
      light.position.set(cx + x, 2.82, cz + 4.38)
      this.scene.add(light)
    }

    for (const x of [-3.1, 3.1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.1, 0.09), glass)
      window.position.set(x, 2.05, cz + 4.03)
      this.scene.add(window)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.34, 1.28, 0.1), trim)
      frame.position.set(x, 2.05, cz + 4.0)
      this.scene.add(frame)
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.02, 0.11), glass)
      pane.position.set(x, 2.05, cz + 4.08)
      this.scene.add(pane)
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.06, 0.12), wall)
      cross.position.set(x, 2.05, cz + 4.15)
      this.scene.add(cross)
      const windowGlow = new THREE.PointLight('#ffb65c', 1.25, 8, 2)
      windowGlow.position.set(x, 2.05, cz + 4.45)
      this.scene.add(windowGlow)
    }
    wallBox(cx, 0.14, cz + 4.6, 3.1, 0.28, 2.1, false, trim)
    for (const x of [-4.2, -3.6, 3.6, 4.2]) {
      const pot = mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 8), '#ad6959', [x, 0.17, cz + 4.5])
      this.scene.add(pot)
    }
    this.makeHouseInterior()
    this.scene.userData.houseWallColliderCount = solidWallColliderCount
    this.scene.userData.houseWallsSolid = solidWallColliderCount === 6
    this.scene.userData.houseDoorwayWidth = 4.8
    this.houseDoorCollider = this.physics.addStaticBox(new THREE.Vector3(0, 1.45, -18.96), new THREE.Vector3(1.8, 2.8, 0.3))
    this.scene.userData.houseDoorOpen = false
  }

  private makeHouseInterior(): void {
    const table = new THREE.Group()
    table.name = 'Birthday table inside the cottage'
    table.position.set(0, 0, -22.85)
    const wood = new THREE.MeshStandardMaterial({ color: '#77503c', roughness: 0.9 })
    const darkWood = new THREE.MeshStandardMaterial({ color: '#533827', roughness: 0.95 })
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 1.55), wood)
    top.position.y = 0.95
    top.castShadow = true
    top.receiveShadow = true
    table.add(top)
    this.physics.addStaticBox(new THREE.Vector3(0, 0.95, -22.85), new THREE.Vector3(2.9, 0.18, 1.55))
    for (const x of [-1.23, 1.23]) {
      for (const z of [-0.61, 0.61]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.18), darkWood)
        leg.position.set(x, 0.47, z)
        leg.castShadow = true
        table.add(leg)
        this.physics.addStaticBox(new THREE.Vector3(x, 0.47, -22.85 + z), new THREE.Vector3(0.18, 0.78, 0.18))
      }
    }
    this.scene.add(table)

    const cake = new THREE.Group()
    cake.name = 'Birthday cake with lit candles'
    cake.position.set(0.58, 0, -22.85)
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.68, 0.07, 18), new THREE.MeshStandardMaterial({ color: '#f0d0a0', roughness: 0.48, metalness: 0.12 }))
    plate.position.y = 1.085
    cake.add(plate)
    const cakeBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.34, 16), new THREE.MeshStandardMaterial({ color: '#e88caf', roughness: 0.67 }))
    cakeBottom.position.y = 1.29
    cakeBottom.castShadow = true
    cake.add(cakeBottom)
    const cakeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.28, 16), new THREE.MeshStandardMaterial({ color: '#fff0d6', roughness: 0.55 }))
    cakeTop.position.y = 1.59
    cakeTop.castShadow = true
    cake.add(cakeTop)
    const berryMat = new THREE.MeshStandardMaterial({ color: '#b83c55', roughness: 0.42 })
    for (let i = 0; i < 10; i += 1) {
      const angle = i / 10 * Math.PI * 2
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), berryMat)
      berry.position.set(Math.cos(angle) * 0.27, 1.75, Math.sin(angle) * 0.27)
      cake.add(berry)
    }
    const candleMat = new THREE.MeshStandardMaterial({ color: '#fbefd3', emissive: '#8a5a32', emissiveIntensity: 0.18, roughness: 0.4 })
    const flameMat = new THREE.MeshStandardMaterial({ color: '#ffb23f', emissive: '#ff821f', emissiveIntensity: 1.8, roughness: 0.36 })
    const candles: ReadonlyArray<readonly [number, number]> = [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]
    for (const [x, z] of candles) {
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.043, 0.27, 8), candleMat)
      candle.position.set(x, 1.835, z)
      cake.add(candle)
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 8), flameMat)
      flame.name = 'Birthday candle flame'
      flame.position.set(x, 2.045, z)
      cake.add(flame)
      const light = new THREE.PointLight('#ffb951', 0.36, 3.4, 2)
      light.position.copy(flame.position)
      cake.add(light)
      this.candleFlames.push({ mesh: flame, light })
    }
    this.scene.add(cake)
    this.scene.userData.birthdayCakeCount = 1
    this.scene.userData.cakeCandleCount = candles.length
    const interiorGlow = new THREE.PointLight('#ffd19a', 0.8, 13, 1.7)
    interiorGlow.position.set(0, 3.05, -22.8)
    this.scene.add(interiorGlow)

    const paper = new THREE.MeshStandardMaterial({ color: '#fff3d9', roughness: 0.96, side: THREE.DoubleSide })
    const ink = new THREE.MeshStandardMaterial({ color: '#805341', roughness: 0.88 })
    const seal = new THREE.MeshStandardMaterial({ color: '#ce5a6e', emissive: '#691d39', emissiveIntensity: 0.3, roughness: 0.46 })
    const letter = new THREE.Group()
    letter.name = 'Birthday letter beside the cake'
    letter.position.set(this.birthdayLetterPosition.x, 1.1, this.birthdayLetterPosition.z)
    const envelope = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.045, 0.5), paper)
    envelope.castShadow = true
    letter.add(envelope)
    for (const z of [-0.08, 0, 0.08]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.009, 0.014), ink)
      line.position.set(-0.05, 0.028, z)
      letter.add(line)
    }
    const waxSeal = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), seal)
    waxSeal.position.set(0.25, 0.044, 0.12)
    letter.add(waxSeal)
    this.scene.add(letter)
    this.birthdayLetter = letter
    this.scene.userData.birthdayLetterInteractable = true
    this.scene.userData.birthdayLetterRead = false

    const marker = new THREE.Group()
    marker.name = 'Birthday letter quest glimmer'
    marker.position.set(this.birthdayLetterPosition.x, 1.48, this.birthdayLetterPosition.z)
    const glowMat = new THREE.MeshStandardMaterial({ color: '#ffe5a0', emissive: '#ffb93d', emissiveIntensity: 1.5, side: THREE.DoubleSide })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 24), glowMat)
    ring.rotation.x = -Math.PI / 2
    marker.add(ring)
    const sparkleGeo = new THREE.IcosahedronGeometry(0.055, 0)
    for (let i = 0; i < 4; i += 1) {
      const sparkle = new THREE.Mesh(sparkleGeo, glowMat)
      const angle = i / 4 * Math.PI * 2
      sparkle.position.set(Math.cos(angle) * 0.31, 0.05 + (i % 2) * 0.09, Math.sin(angle) * 0.31)
      marker.add(sparkle)
    }
    this.scene.add(marker)
    this.letterMarker = marker
    const letterLight = new THREE.PointLight('#ffce78', 0.5, 4, 2)
    letterLight.position.set(this.birthdayLetterPosition.x, 1.65, this.birthdayLetterPosition.z)
    this.scene.add(letterLight)
    this.letterLight = letterLight
  }

  private makeAutumnTree(random: () => number): void {
    const tree = new THREE.Group()
    tree.name = 'Large autumn tree beside the cottage'
    tree.position.set(10.2, 0, -21.8)
    const bark = new THREE.MeshStandardMaterial({ color: '#63432f', roughness: 1 })
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.78, 8.1, 9), bark)
    trunk.position.y = 4.05
    trunk.castShadow = true
    tree.add(trunk)
    this.physics.addStaticCylinder(new THREE.Vector3(10.2, 4.05, -21.8), 0.68, 8.1)

    const up = new THREE.Vector3(0, 1, 0)
    const addBranch = (from: THREE.Vector3, to: THREE.Vector3, radius: number) => {
      const direction = new THREE.Vector3().subVectors(to, from)
      const length = direction.length()
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.54, radius, length, 8), bark)
      branch.position.copy(from).add(to).multiplyScalar(0.5)
      branch.quaternion.setFromUnitVectors(up, direction.normalize())
      branch.castShadow = true
      tree.add(branch)
    }
    addBranch(new THREE.Vector3(0, 6.3, 0), new THREE.Vector3(-4.7, 7.7, 0.18), 0.33)
    addBranch(new THREE.Vector3(0, 6.4, 0), new THREE.Vector3(3.7, 7.8, 0.28), 0.3)
    addBranch(new THREE.Vector3(0, 5.6, 0), new THREE.Vector3(0.2, 7.6, -3.9), 0.25)
    addBranch(new THREE.Vector3(0, 5.8, 0), new THREE.Vector3(0.3, 7.4, 3.6), 0.24)

    const autumnColors = ['#c64d2d', '#df6d25', '#ec9c32', '#a94736', '#cf7b2b']
    const foliageMats = autumnColors.map(color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.075, roughness: 0.93 }))
    const clusters: { position: THREE.Vector3; scale: number; yaw: number }[][] = autumnColors.map(() => [])
    for (let i = 0; i < 44; i += 1) {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random()) * 5.2
      const bucket = Math.floor(random() * autumnColors.length)
      clusters[bucket].push({
        position: new THREE.Vector3(Math.cos(angle) * radius, 7.9 + (random() - 0.5) * 3.4, Math.sin(angle) * radius * 0.82),
        scale: 1 + random() * 0.9,
        yaw: random() * Math.PI * 2,
      })
    }
    const leafGeometry = new THREE.IcosahedronGeometry(1, 1)
    const dummy = new THREE.Object3D()
    foliageMats.forEach((material, colorIndex) => {
      const leaves = clusters[colorIndex]
      const instances = new THREE.InstancedMesh(leafGeometry, material, leaves.length)
      instances.name = `Autumn canopy ${autumnColors[colorIndex]}`
      for (let i = 0; i < leaves.length; i += 1) {
        const leaf = leaves[i]
        dummy.position.copy(leaf.position)
        dummy.rotation.set((random() - 0.5) * 0.2, leaf.yaw, (random() - 0.5) * 0.22)
        dummy.scale.set(leaf.scale * 1.15, leaf.scale * 0.83, leaf.scale)
        dummy.updateMatrix()
        instances.setMatrixAt(i, dummy.matrix)
      }
      instances.instanceMatrix.needsUpdate = true
      instances.castShadow = true
      instances.receiveShadow = true
      tree.add(instances)
    })

    this.swingPivot.name = 'Big wooden swing'
    this.swingPivot.position.set(-2.55, 7.4, 0.18)
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#6b4a31', roughness: 0.94 })
    const seatMat = new THREE.MeshStandardMaterial({ color: '#805438', roughness: 0.88 })
    for (const x of [-0.68, 0.68]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 6.23, 7), ropeMat)
      rope.position.set(x, -3.13, 0)
      this.swingPivot.add(rope)
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 0.5), seatMat)
    seat.position.set(0, -6.28, 0)
    seat.castShadow = true
    this.swingPivot.add(seat)
    for (const z of [-0.14, 0, 0.14]) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.045, 0.065), bark)
      slat.position.set(0, -6.145, z)
      this.swingPivot.add(slat)
    }
    tree.add(this.swingPivot)
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#8f5c35', roughness: 0.95 })
    const fence = new THREE.Group()
    fence.name = 'Fence around swing tree'
    const addFenceSide = (horizontal: boolean, offset: number, length: number) => {
      const posts = Math.ceil(length / 2.4) + 1
      for (let i = 0; i < posts; i += 1) {
        const along = -length / 2 + (length * i) / (posts - 1)
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.25, 7), fenceMat)
        post.position.set(horizontal ? along : offset, 0.625, horizontal ? offset : along)
        post.castShadow = true
        fence.add(post)
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 0.14, 0.12, horizontal ? 0.14 : length), fenceMat)
      rail.position.set(horizontal ? 0 : offset, 0.42, horizontal ? offset : 0)
      rail.castShadow = true
      fence.add(rail)
      const upperRail = rail.clone()
      upperRail.position.y = 0.9
      fence.add(upperRail)
      this.physics.addStaticBox(
        new THREE.Vector3(horizontal ? 10.2 : 10.2 + offset, 0.62, horizontal ? -21.8 + offset : -21.8),
        new THREE.Vector3(horizontal ? length : 0.18, 1.25, horizontal ? 0.18 : length),
      )
    }
    // Three sides leave the south-facing path open for access to the swing.
    fence.position.set(0, 0, 0)
    addFenceSide(true, -4.8, 10.4)
    addFenceSide(false, -5.2, 9.6)
    addFenceSide(false, 5.2, 9.6)
    tree.add(fence)
    const fallingLeafGeometry = new THREE.IcosahedronGeometry(0.13, 0)
    const leafMaterial = new THREE.MeshStandardMaterial({ color: '#d86a2c', roughness: 0.9, transparent: true })
    for (let i = 0; i < 18; i += 1) {
      const material = leafMaterial.clone()
      const leaf = new THREE.Mesh(fallingLeafGeometry, material)
      const phase = i / 18
      const origin = new THREE.Vector3(10.2 + (i % 6 - 2.5) * 1.2, 9 + Math.floor(i / 6) * 1.2, -21.8 + ((i * 7) % 5 - 2) * 0.9)
      leaf.position.copy(origin)
      leaf.castShadow = true
      this.scene.add(leaf)
      this.fallingLeaves.push({ mesh: leaf, origin, phase, speed: 0.65 + (i % 4) * 0.08, material })
    }
    this.scene.add(tree)
    this.scene.userData.autumnTreeCount = 1
    this.scene.userData.autumnCanopyClusterCount = 44
    this.scene.userData.gardenSwingCount = 1
    this.scene.userData.gardenSwingAnimated = true
  }

  private makeFlowerBeds(random: () => number, tulipModel?: THREE.Object3D): void {
    const coarseDevice = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
    const perSideTarget = coarseDevice ? 350 : 900
    const colors = GARDEN_FLOWER_COLORS
    const placements = generateTulipPlacements(random, perSideTarget)
    const flowersLeft = placements.filter(placement => placement.x < 0).length
    const flowersRight = placements.length - flowersLeft
    this.scene.userData.flowerColors = colors.length
    this.scene.userData.flowerBedsBySide = { left: flowersLeft, right: flowersRight }
    this.scene.userData.flowerPathClearance = FLOWER_PATH_MARGIN
    this.scene.userData.pathFlowerViolations = placements.filter(placement => isOnGardenPath(placement.x, placement.z)).length
    this.scene.userData.tulipModelLoaded = tulipModel !== undefined
    this.scene.userData.tulipClusterCount = placements.length
    for (let i = 5; i < placements.length; i += 13) {
      const placement = placements[i]
      this.pickableTulips.push({ position: new THREE.Vector3(placement.x, 0, placement.z), placement, slots: [], picked: false })
    }
    this.scene.userData.pickableTulipsTotal = this.pickableTulips.length
    this.scene.userData.pickableTulipsRemaining = this.pickableTulips.length

    if (tulipModel) {
      this.addSuppliedTulips(tulipModel, placements, colors)
      let bloomMeshes = 0
      tulipModel.traverse(object => {
        const source = object as THREE.Mesh
        if (source.isMesh && /transparent|petal|bloom|flower/i.test(`${source.name} ${source.material instanceof THREE.Material ? source.material.name : ''}`)) bloomMeshes += 1
      })
      this.flowerCount = placements.length * Math.max(1, bloomMeshes)
    } else {
      this.addProceduralTulips(placements, colors)
      this.flowerCount = placements.length
    }

    // Raised edging makes each broad flower bed readable from the path.
    const bedMat = new THREE.MeshStandardMaterial({ color: '#aa896b', roughness: 1 })
    for (const x of [-24, -12, 13, 25]) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(10, 0.09, 0.7), bedMat)
      bed.position.set(x, 0.01, -4 + (x % 3) * 5)
      bed.rotation.y = x * 0.015
      this.scene.add(bed)
    }
  }

  private addSuppliedTulips(model: THREE.Object3D, placements: TulipPlacement[], colors: string[]): void {
    const source = model.clone(true)
    source.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(source)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = 0.98 / Math.max(size.y, 0.001)
    const normalize = new THREE.Matrix4().makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z))
    const sourceMeshes: THREE.Mesh[] = []
    source.traverse(object => {
      const candidate = object as THREE.Mesh
      if (candidate.isMesh && candidate.geometry) sourceMeshes.push(candidate)
    })
    const pickableByPlacement = new Map(this.pickableTulips.map(tulip => [tulip.placement, tulip]))

    const dummy = new THREE.Object3D()
    const matrix = new THREE.Matrix4()
    for (const sourceMesh of sourceMeshes) {
      const sourceMaterials = Array.isArray(sourceMesh.material) ? sourceMesh.material : [sourceMesh.material]
      const isPetal = /transparent|petal|bloom|flower/i.test(`${sourceMesh.name} ${sourceMaterials.map(material => material.name).join(' ')}`)
      const groups = isPetal ? colors.map((_color, index) => placements.filter(placement => placement.color === index)) : [placements]
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const members = groups[groupIndex]
        if (!members.length) continue
        const materials = sourceMaterials.map(material => {
          const clone = material.clone()
          if (isPetal && clone instanceof THREE.MeshStandardMaterial) {
            clone.color.set(colors[groupIndex])
            clone.emissive.set(colors[groupIndex])
            clone.emissiveIntensity = 0.18
          }
          return clone
        })
        const material: THREE.Material | THREE.Material[] = Array.isArray(sourceMesh.material) ? materials : materials[0]
        const instances = new THREE.InstancedMesh(sourceMesh.geometry, material, members.length)
        const baseTransform = normalize.clone().multiply(sourceMesh.matrixWorld)
        for (let i = 0; i < members.length; i += 1) {
          const flower = members[i]
          dummy.position.set(flower.x, 0, flower.z)
          dummy.rotation.set(0, flower.rotation, 0)
          dummy.scale.setScalar(flower.scale)
          dummy.updateMatrix()
          matrix.multiplyMatrices(dummy.matrix, baseTransform)
          instances.setMatrixAt(i, matrix)
        }
        instances.instanceMatrix.needsUpdate = true
        instances.castShadow = false
        instances.receiveShadow = false
        instances.name = isPetal ? `Supplied tulip petals ${colors[groupIndex]}` : `Supplied tulip leaves ${sourceMesh.name}`
        this.scene.add(instances)
        for (let i = 0; i < members.length; i += 1) {
          const pickable = pickableByPlacement.get(members[i])
          if (pickable) pickable.slots.push({ mesh: instances, index: i })
        }
      }
    }
  }

  private addProceduralTulips(placements: TulipPlacement[], colors: string[]): void {
    const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.035, 0.72, 5), new THREE.MeshStandardMaterial({ color: '#438a4e', roughness: 0.95 }), placements.length)
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.42, 4), new THREE.MeshStandardMaterial({ color: '#4a9a52', roughness: 0.95 }), placements.length * 2)
    const bloom = new THREE.InstancedMesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.015, 0), new THREE.Vector2(0.11, 0.04), new THREE.Vector2(0.17, 0.19),
      new THREE.Vector2(0.135, 0.31), new THREE.Vector2(0.08, 0.42), new THREE.Vector2(0.02, 0.36),
    ], 7), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.52, side: THREE.DoubleSide }), placements.length)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < placements.length; i += 1) {
      const flower = placements[i]
      const height = 0.58 + flower.scale * 0.24
      dummy.position.set(flower.x, height * 0.5, flower.z)
      dummy.rotation.set(0, flower.rotation, 0)
      dummy.scale.set(flower.scale, height / 0.72, flower.scale)
      dummy.updateMatrix()
      stem.setMatrixAt(i, dummy.matrix)
      dummy.position.set(flower.x + 0.08, 0.24, flower.z)
      dummy.rotation.set(0, flower.rotation, -0.88)
      dummy.scale.set(0.82, 1, 0.7)
      dummy.updateMatrix()
      leaf.setMatrixAt(i * 2, dummy.matrix)
      dummy.position.set(flower.x - 0.08, 0.28, flower.z)
      dummy.rotation.set(0, flower.rotation, 0.94)
      dummy.updateMatrix()
      leaf.setMatrixAt(i * 2 + 1, dummy.matrix)
      dummy.position.set(flower.x, height + 0.04, flower.z)
      dummy.rotation.set(0, flower.rotation, 0)
      dummy.scale.setScalar(flower.scale)
      dummy.updateMatrix()
      bloom.setMatrixAt(i, dummy.matrix)
      bloom.setColorAt(i, new THREE.Color(colors[flower.color]))
    }
    stem.instanceMatrix.needsUpdate = leaf.instanceMatrix.needsUpdate = bloom.instanceMatrix.needsUpdate = true
    if (bloom.instanceColor) bloom.instanceColor.needsUpdate = true
    stem.receiveShadow = leaf.receiveShadow = bloom.receiveShadow = true
    stem.castShadow = bloom.castShadow = true
    stem.name = 'Tulip stems'
    leaf.name = 'Tulip leaves'
    bloom.name = 'Colorful tulips'
    this.scene.add(stem, leaf, bloom)
    const placementIndices = new Map(placements.map((placement, index) => [placement, index]))
    for (const tulip of this.pickableTulips) {
      const index = placementIndices.get(tulip.placement)
      if (index === undefined) continue
      tulip.slots.push({ mesh: stem, index }, { mesh: leaf, index: index * 2 }, { mesh: leaf, index: index * 2 + 1 }, { mesh: bloom, index })
    }
  }

  private makeTrees(random: () => number): void {
    const bark = new THREE.MeshStandardMaterial({ color: '#302018', roughness: 1 })
    const leaves = ['#8f4a1d', '#b06a1d', '#76241f', '#a13b20', '#5f261e'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.94 }))
    const positions: Array<readonly [number, number]> = [
      [-35, -19], [34, -13], [-39, 20], [37, 25], [-23, 37], [20, 40], [40, -37], [-40, -38],
      [-33, 5], [31, 8], [-14, 39], [7, 40], [-38, -6], [39, 8], [-30, -35], [29, -31],
      [-13, 34], [34, 36], [-39, 34], [39, -20],
    ]
    let placed = 0
    for (const [x, z] of positions) {
      if (
        isOnGardenPath(x, z, 3.2)
        || Math.hypot(x, z + 23) < 11
        || Math.hypot(x - 10.2, z + 21.8) < 10
      ) continue
      const tree = new THREE.Group()
      tree.position.set(x, 0, z)
      tree.scale.setScalar(0.9 + random() * 0.3)
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.48, 4.4, 7), bark)
      trunk.position.y = 2.2
      trunk.castShadow = true
      tree.add(trunk)
      for (let i = 0; i < 6; i += 1) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35 + random() * 0.6, 1), leaves[Math.floor(random() * leaves.length)])
        crown.position.set((random() - 0.5) * 2.8, 4.15 + (random() - 0.5) * 2.1, (random() - 0.5) * 2.3)
        crown.scale.set(1.12, 0.92, 1)
        crown.castShadow = true
        tree.add(crown)
      }
      this.scene.add(tree)
      this.physics.addStaticCylinder(new THREE.Vector3(x, 1.4, z), 0.34, 2.8)
      placed += 1
    }
    this.scene.userData.autumnGardenTreeCount = placed
  }

  private makeBoundary(random: () => number): void {
    const hedgeMat = new THREE.MeshStandardMaterial({ color: '#4e8951', roughness: 0.98 })
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#f1e4c7', roughness: 0.9 })
    // Distant hedges soften the horizon but leave generous gaps to roam beyond the flower beds.
    for (const [x, z, sx, sz] of [[-43, 0, 2, 82], [43, 0, 2, 82], [0, -43, 88, 2], [0, 43, 88, 2]] as const) {
      const hedge = new THREE.Mesh(new THREE.BoxGeometry(sx, 2.6, sz), hedgeMat)
      hedge.position.set(x, 1.15, z)
      hedge.castShadow = true
      this.scene.add(hedge)
    }
    this.physics.addStaticBox(new THREE.Vector3(-43, 1.15, 0), new THREE.Vector3(2, 2.6, 82))
    this.physics.addStaticBox(new THREE.Vector3(43, 1.15, 0), new THREE.Vector3(2, 2.6, 82))
    this.physics.addStaticBox(new THREE.Vector3(0, 1.15, -43), new THREE.Vector3(82, 2.6, 2))
    this.physics.addStaticBox(new THREE.Vector3(0, 1.15, 43), new THREE.Vector3(82, 2.6, 2))

    const shrubGeometry = new THREE.IcosahedronGeometry(1, 1)
    const shrubMaterials = ['#355d42', '#47734b', '#6c4e39'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }))
    const edgeDecorations: Array<[number, number, number]> = [
      [-39, -37, 1.4], [-30, -40, 1.1], [-17, -40, 1.3], [0, -40, 1.05], [18, -40, 1.35], [32, -38, 1.2],
      [-39, 37, 1.25], [-23, 40, 1.05], [-6, 39, 1.35], [12, 40, 1.15], [29, 39, 1.4],
      [-40, -25, 1.15], [-40, -9, 1.35], [-40, 9, 1.1], [-40, 25, 1.3],
      [40, -31, 1.3], [40, -14, 1.05], [40, 4, 1.35], [40, 22, 1.15],
    ]
    for (const [x, z, scale] of edgeDecorations) {
      const shrub = new THREE.Mesh(shrubGeometry, shrubMaterials[Math.abs(Math.round(x + z)) % shrubMaterials.length])
      shrub.position.set(x, 0.72 * scale, z)
      shrub.scale.set(scale * 1.3, scale * 0.72, scale)
      shrub.castShadow = true
      shrub.receiveShadow = true
      this.scene.add(shrub)
    }
    // A short white fence frames the little entry gate, not the whole world.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i += 1) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), fenceMat)
        post.position.set(side * (2.6 + i * 0.58), 0.52, 20.5)
        post.castShadow = true
        this.scene.add(post)
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.1), fenceMat)
      rail.position.set(side * 5.2, 0.66, 20.5)
      this.scene.add(rail)
    }
    this.scene.userData.flowerCount = this.flowerCount
    void random
  }

  private makeWelcomeSign(): void {
    const signX = 8.2
    const signZ = 18
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.3, 7), new THREE.MeshStandardMaterial({ color: '#77523c', roughness: 1 }))
    post.position.set(signX, 1.15, signZ)
    this.scene.add(post)
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.05, 0.2), new THREE.MeshStandardMaterial({ color: '#8b6040', roughness: 1 }))
    board.position.set(signX, 2, signZ)
    this.scene.add(board)
    const texture = this.makeTextTexture("Dua's Adventure", '#fff5dd')
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.73), new THREE.MeshBasicMaterial({ map: texture, transparent: true }))
    sign.position.set(signX, 2, signZ + 0.106)
    this.scene.add(sign)
  }

  private makeRabbits(random: () => number): void {
    const fur = ['#fffaf2', '#e9ded2', '#f4eee2', '#d8d2c5']
    const heartTexture = this.makeHeartTexture()
    for (let i = 0; i < 11; i += 1) {
      const x = (random() - 0.5) * 45
      let z = (random() - 0.5) * 42
      if (Math.abs(x) < 7 && z < -14 && z > -31) z += 18
      if (Math.abs(x) < 3.5 && z < 13 && z > -20) z += 18
      const root = createGardenBunny(0.66 + random() * 0.26, fur[i % fur.length])
      root.position.set(x, 0, z)
      const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTexture, transparent: true, depthWrite: false }))
      heart.scale.set(0.42, 0.42, 1)
      heart.position.set(0, 1.4, 0)
      heart.visible = false
      root.add(heart)
      this.scene.add(root)
      this.rabbits.push({ root, heart, baseScale: root.scale.x, x, z, phase: random() * Math.PI * 2, speed: 0.65 + random() * 0.55, radius: 0.55 + random() * 1.35, fedUntil: 0, nextFeedAt: 0 })
    }
  }

  private makeHeartTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff8fb5'
    context.strokeStyle = '#fff0da'
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(48, 82)
    context.bezierCurveTo(39, 73, 12, 53, 12, 34)
    context.bezierCurveTo(12, 12, 38, 13, 48, 31)
    context.bezierCurveTo(58, 13, 84, 12, 84, 34)
    context.bezierCurveTo(84, 53, 57, 73, 48, 82)
    context.fill()
    context.stroke()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private makeNameTag(text: string): THREE.Sprite {
    const texture = this.makeTextTexture(text, '#fffdf7')
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(2.65, 0.56, 1)
    return sprite
  }

  private makeTextTexture(text: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(37, 31, 48, 0.72)'
    ctx.beginPath()
    ctx.roundRect(8, 10, 496, 76, 18)
    ctx.fill()
    ctx.fillStyle = color
    ctx.font = 'bold 42px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
}
