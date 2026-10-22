import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { advanceForestQuest, INITIAL_FOREST_QUEST_STATE, type ForestQuestState } from './forest-quest'

const CENTER_X = 142
const FOREST_SPAWN = new THREE.Vector3(110, 1.1, 14)
const GATE_GROUND = new THREE.Vector3(187.4, 0, 0)
const TREE_COLORS = ['#8f4a1d', '#b06a1d', '#76241f', '#a13b20', '#5f261e']
const MUSHROOM_COLORS = ['#80f4da', '#a78bfa', '#f28fc0', '#f2c86d']

type ForestInteraction = 'key-found' | 'gate-locked' | 'gate-opening' | null
export type ForestPrompt = 'forestKey' | 'forestGateLocked' | 'forestGateReady'

/** Self-contained first level. It owns forest visuals, static colliders and the key/gate quest. */
export class ForestLevel {
  readonly scene = new THREE.Scene()
  readonly spawn = FOREST_SPAWN.clone()
  readonly keyPosition = new THREE.Vector3(148, 0, -9)
  readonly gatePosition = GATE_GROUND.clone()
  state: ForestQuestState = INITIAL_FOREST_QUEST_STATE

  private readonly keyRoot = new THREE.Group()
  private readonly keySparkles = new THREE.Group()
  private readonly leftGate = new THREE.Group()
  private readonly rightGate = new THREE.Group()
  private gateGoldLight!: THREE.PointLight
  private gateGoldMaterial!: THREE.MeshStandardMaterial
  private gateCollider: ReturnType<Physics['addStaticBox']> | undefined
  private gateOpening = false
  private gateOpenTime = 0
  private elapsed = 0

  constructor(private readonly physics: Physics, shadowMapSize: number) {
    this.scene.background = new THREE.Color('#07101b')
    this.scene.fog = new THREE.FogExp2('#101e2b', 0.014)
    this.scene.add(new THREE.HemisphereLight('#a9bce2', '#253135', 0.96))
    this.relocateKey()

    const moonlight = new THREE.DirectionalLight('#d0ddff', 1.72)
    moonlight.position.set(CENTER_X - 26, 36, -22)
    moonlight.castShadow = true
    moonlight.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    moonlight.shadow.camera.left = moonlight.shadow.camera.bottom = -58
    moonlight.shadow.camera.right = moonlight.shadow.camera.top = 58
    moonlight.shadow.camera.near = 1
    moonlight.shadow.camera.far = 110
    moonlight.shadow.bias = -0.0005
    this.scene.add(moonlight, moonlight.target)
    moonlight.target.position.set(CENTER_X, 0, 0)

    this.makeMoonAndStars()
    this.makeTerrain()
    this.makeTrail()
    this.makeForest()
    this.makeMushroomsAndFerns()
    this.makeForestKey()
    this.makeGardenGate()

    this.scene.userData.level = 'The Dark Forest'
    this.scene.userData.theme = 'moonlit-fog'
    this.scene.userData.forestKeyName = 'Forest Key'
    this.scene.userData.gateName = 'Garden Gate'
    this.scene.userData.starShapeCount = 52
    this.scene.userData.questState = this.state
  }

  prompt(position: THREE.Vector3): ForestPrompt | null {
    const keyDistance = horizontalDistance(position, this.keyPosition)
    const gateDistance = horizontalDistance(position, this.gatePosition)
    if (this.state === 'SEARCHING_KEY' && keyDistance <= 3.1 && keyDistance <= gateDistance) return 'forestKey'
    if (gateDistance <= 6.2 && this.state !== 'LEVEL_COMPLETE') {
      return this.state === 'KEY_FOUND' ? 'forestGateReady' : 'forestGateLocked'
    }
    return null
  }

  interact(position: THREE.Vector3): ForestInteraction {
    if (this.state === 'SEARCHING_KEY' && horizontalDistance(position, this.keyPosition) <= 2.8) {
      this.state = advanceForestQuest(this.state, 'find-key')
      this.keyRoot.visible = false
      this.scene.userData.questState = this.state
      this.scene.userData.forestKeyFound = true
      return 'key-found'
    }

    if (horizontalDistance(position, this.gatePosition) > 6.2 || this.state === 'LEVEL_COMPLETE') return null
    if (this.state !== 'KEY_FOUND') return 'gate-locked'
    if (this.gateOpening) return null

    this.gateOpening = true
    this.gateOpenTime = 0
    this.scene.userData.gateOpening = true
    return 'gate-opening'
  }

  /** Advance bobbing collectibles, gate doors, and warm forest light. Returns true once on completion. */
  update(dt: number): boolean {
    this.elapsed += dt
    if (this.keyRoot.visible) {
      this.keyRoot.position.y = 1.02 + Math.sin(this.elapsed * 2.25) * 0.17
      this.keyRoot.rotation.y = Math.sin(this.elapsed * 0.8) * 0.16
      this.keySparkles.rotation.y += dt * 0.6
      for (const [i, sparkle] of this.keySparkles.children.entries()) {
        sparkle.position.y = 0.42 + Math.sin(this.elapsed * 2.5 + i * 1.3) * 0.14
      }
    }
    if (this.gateOpening && this.state === 'KEY_FOUND') {
      this.gateOpenTime = Math.min(1.8, this.gateOpenTime + dt)
      const eased = 1 - Math.pow(1 - this.gateOpenTime / 1.8, 3)
      this.leftGate.rotation.y = -eased * Math.PI * 0.5
      this.rightGate.rotation.y = eased * Math.PI * 0.5
      this.gateGoldLight.intensity = 0.28 + eased * 3.4
      this.gateGoldLight.distance = 9 + eased * 16
      this.gateGoldMaterial.emissiveIntensity = 0.1 + eased * 1.6
      if (this.gateOpenTime >= 1.8) {
        this.state = advanceForestQuest(this.state, 'open-gate')
        if (this.gateCollider) {
          this.physics.world.removeCollider(this.gateCollider, true)
          this.gateCollider = undefined
        }
        this.scene.userData.questState = this.state
        this.scene.userData.gateOpen = true
        return true
      }
    }
    return false
  }

  /** Restore the introductory quest if the player leaves and selects Start Over. */
  reset(): void {
    this.relocateKey()
    this.state = 'SEARCHING_KEY'
    this.scene.userData.questState = this.state
    this.scene.userData.forestKeyFound = false
    this.scene.userData.gateOpening = false
    this.scene.userData.gateOpen = false
    this.keyRoot.visible = true
    this.gateOpening = false
    this.gateOpenTime = 0
    this.leftGate.rotation.y = 0
    this.rightGate.rotation.y = 0
    this.gateGoldLight.intensity = 0.2
    this.gateGoldLight.distance = 9
    this.gateGoldMaterial.emissiveIntensity = 0.08
    this.gateCollider ??= this.physics.addStaticBox(
      new THREE.Vector3(this.gatePosition.x + 0.7, 1.6, this.gatePosition.z),
      new THREE.Vector3(0.9, 3.2, 8.4),
    )
  }

  private relocateKey(): void {
    const previous = this.keyPosition.clone()
    for (let attempt = 0; attempt < 240; attempt += 1) {
      // Sample the playable forest directly instead of walking a seeded route. This makes each
      // new run independent and prevents the key from repeating the same interpolation point.
      const candidate = new THREE.Vector3(
        120 + Math.random() * 58,
        0,
        -28 + Math.random() * 52,
      )
      if (
        horizontalDistance(candidate, this.spawn) < 24
        || horizontalDistance(candidate, this.gatePosition) < 18
        || horizontalDistance(candidate, previous) < 10
      ) continue
      this.keyPosition.copy(candidate)
      if (this.keyRoot.parent) this.keyRoot.position.set(candidate.x, 1.02, candidate.z)
      return
    }
    this.keyPosition.set(148, 0, -9)
    if (this.keyRoot.parent) this.keyRoot.position.set(this.keyPosition.x, 1.02, this.keyPosition.z)
  }

  private makeMoonAndStars(): void {
    const sky = new THREE.Group()
    sky.position.x = CENTER_X
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(142, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ color: '#1a2b42', side: THREE.BackSide, depthWrite: false, fog: false }),
    )
    dome.renderOrder = -30
    dome.frustumCulled = false
    sky.add(dome)

    const shape = new THREE.Shape()
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 5
      const radius = i % 2 === 0 ? 1 : 0.42
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    }
    shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape)
    const stars = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      color: '#ffe28a', side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false,
    }), 104)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < 104; i += 1) {
      const azimuth = seededValue(i, 17) * Math.PI * 2
      const elevation = (0.12 + seededValue(i, 59) * 0.83) * Math.PI * 0.5
      const distance = 113 + seededValue(i, 101) * 10
      dummy.position.set(
        Math.cos(elevation) * Math.cos(azimuth) * distance,
        Math.sin(elevation) * distance,
        Math.cos(elevation) * Math.sin(azimuth) * distance,
      )
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dummy.position.clone().normalize().negate())
      dummy.rotateZ(seededValue(i, 151) * Math.PI * 2)
      dummy.scale.setScalar(1.15 + seededValue(i, 211) * 0.6)
      dummy.updateMatrix()
      stars.setMatrixAt(i, dummy.matrix)
    }
    stars.instanceMatrix.needsUpdate = true
    stars.renderOrder = -20
    stars.frustumCulled = false
    sky.add(stars)
    this.scene.add(sky)

    const moonGlow = new THREE.Mesh(
      new THREE.SphereGeometry(3.5, 24, 18),
      new THREE.MeshBasicMaterial({ color: '#d7e4ff', transparent: true, opacity: 0.075, fog: false, depthWrite: false }),
    )
    moonGlow.position.set(CENTER_X - 22, 10.5, -35)
    this.scene.add(moonGlow)
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(2, 24, 18),
      new THREE.MeshBasicMaterial({ color: '#e7edff', fog: false, toneMapped: false }),
    )
    moon.position.copy(moonGlow.position)
    this.scene.add(moon)
    const moonLamp = new THREE.PointLight('#c6d5ff', 1.2, 42, 2)
    moonLamp.position.copy(moon.position)
    this.scene.add(moonLamp)
  }

  private makeTerrain(): void {
    const geometry = new THREE.PlaneGeometry(108, 104, 36, 34)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i)
      const z = -positions.getY(i)
      const rolling = Math.sin(x * 0.14) * Math.cos(z * 0.12) * 0.19 + Math.sin((x + z) * 0.075) * 0.11
      positions.setZ(i, rolling)
    }
    geometry.computeVertexNormals()
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#364b43', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.set(CENTER_X, 0, 0)
    ground.receiveShadow = true
    ground.name = 'Uneven dark forest floor'
    this.scene.add(ground)
    this.physics.addStaticBox(new THREE.Vector3(CENTER_X, -0.33, 0), new THREE.Vector3(108, 0.66, 104))

    for (const [x, z, size] of [
      [-22, -28, 15], [21, -28, 18], [28, 27, 16], [-30, 25, 14], [0, 40, 13],
    ] as const) {
      const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshStandardMaterial({ color: '#253638', roughness: 1 }))
      mound.position.set(CENTER_X + x, -0.55, z)
      mound.scale.set(size, 0.85, size * 0.72)
      mound.receiveShadow = true
      this.scene.add(mound)
    }
  }

  private makeTrail(): void {
    const trailMaterial = new THREE.MeshStandardMaterial({ color: '#384239', roughness: 1 })
    const patchGeometry = new THREE.CylinderGeometry(0.83, 0.92, 0.06, 9)
    for (const [start, end] of [[this.spawn, this.keyPosition], [this.keyPosition, this.gatePosition]] as const) {
      const dx = end.x - start.x
      const dz = end.z - start.z
      const length = Math.hypot(dx, dz)
      const count = Math.ceil(length / 3.7)
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count
        const patch = new THREE.Mesh(patchGeometry, trailMaterial)
        patch.position.set(start.x + dx * t, 0.035, start.z + dz * t)
        patch.rotation.y = Math.atan2(dx, dz)
        patch.scale.z = 1.35
        patch.receiveShadow = true
        this.scene.add(patch)
      }
    }
  }

  private makeForest(): void {
    const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.48, 4.4, 7)
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#302018', roughness: 1 })
    const canopyGeometry = [
      new THREE.IcosahedronGeometry(1.55, 1),
      new THREE.IcosahedronGeometry(1.28, 1),
      new THREE.IcosahedronGeometry(1.05, 1),
      new THREE.IcosahedronGeometry(0.9, 1),
    ]
    const canopyMaterials = TREE_COLORS.map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }))
    let trees = 0
    const addPine = (x: number, z: number, scale: number, collision = true) => {
      const tree = new THREE.Group()
      tree.position.set(x, 0, z)
      tree.scale.setScalar(scale)
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial)
      trunk.position.y = 2.2
      trunk.castShadow = true
      tree.add(trunk)
      for (let layer = 0; layer < canopyGeometry.length; layer += 1) {
        const crown = new THREE.Mesh(canopyGeometry[layer], canopyMaterials[(trees + layer) % canopyMaterials.length])
        crown.position.set((layer % 2 === 0 ? -0.65 : 0.65) * scale, 4.1 + layer * 0.55, (layer % 3 - 1) * 0.55)
        crown.scale.set(1.12, 0.92, 1)
        crown.castShadow = true
        tree.add(crown)
      }
      this.scene.add(tree)
      trees += 1
      if (collision) this.physics.addStaticCylinder(new THREE.Vector3(x, 1.2 * scale, z), 0.27 * scale, 2.4 * scale)
    }

    const nearbyPath = (x: number, z: number) =>
      distanceToSegment(x, z, this.spawn, this.keyPosition) < 5 || distanceToSegment(x, z, this.keyPosition, this.gatePosition) < 5
    for (let i = -42; i <= 42; i += 7) {
      addPine(91.5, i + 1, 1.1 + seededValue(i + 44, 31) * 0.55)
      if (Math.abs(i) > 8) addPine(190.1, i + 1, 1.15 + seededValue(i + 51, 67) * 0.5)
    }
    for (let x = 98; x <= 187; x += 7) {
      addPine(x, -46, 1.0 + seededValue(x, 79) * 0.5)
      addPine(x + 2.5, 46, 1.0 + seededValue(x, 113) * 0.52)
    }

    const random = seeded(48151027)
    let placed = 0
    while (placed < 68) {
      const x = 98 + random() * 88
      const z = -41 + random() * 82
      const nearSpawn = horizontalDistance(new THREE.Vector3(x, 0, z), this.spawn) < 8
      const nearKey = Math.hypot(x - this.keyPosition.x, z - this.keyPosition.z) < 7
      const nearGate = Math.hypot(x - this.gatePosition.x, z - this.gatePosition.z) < 8
      if (nearSpawn || nearKey || nearGate || nearbyPath(x, z)) continue
      addPine(x, z, 0.78 + random() * 0.78)
      placed += 1
    }

    this.physics.addStaticBox(new THREE.Vector3(92, 1.8, 0), new THREE.Vector3(1.2, 3.6, 91))
    this.physics.addStaticBox(new THREE.Vector3(190, 1.8, -25.5), new THREE.Vector3(1.2, 3.6, 39))
    this.physics.addStaticBox(new THREE.Vector3(190, 1.8, 25.5), new THREE.Vector3(1.2, 3.6, 39))
    this.physics.addStaticBox(new THREE.Vector3(CENTER_X, 1.8, -46), new THREE.Vector3(98, 3.6, 1.2))
    this.physics.addStaticBox(new THREE.Vector3(CENTER_X, 1.8, 46), new THREE.Vector3(98, 3.6, 1.2))
    this.scene.userData.treeCount = trees

    const rockGeometry = new THREE.IcosahedronGeometry(1, 1)
    const rockMaterials = ['#59645f', '#626c65', '#4c5d5d'].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }))
    for (let i = 0; i < 19; i += 1) {
      const x = 99 + random() * 84
      const z = -39 + random() * 78
      if (nearbyPath(x, z) || horizontalDistance(new THREE.Vector3(x, 0, z), this.spawn) < 5 || Math.hypot(x - this.keyPosition.x, z - this.keyPosition.z) < 5) continue
      const sx = 0.55 + random() * 1.05
      const sy = 0.38 + random() * 0.58
      const sz = 0.5 + random() * 0.9
      const rock = new THREE.Mesh(rockGeometry, rockMaterials[i % rockMaterials.length])
      rock.position.set(x, sy * 0.62, z)
      rock.scale.set(sx, sy, sz)
      rock.rotation.set(random() * 0.2, random() * Math.PI, random() * 0.22)
      rock.castShadow = true
      rock.receiveShadow = true
      this.scene.add(rock)
      this.physics.addStaticBox(new THREE.Vector3(x, sy * 0.65, z), new THREE.Vector3(sx * 1.6, sy * 1.15, sz * 1.6), rock.quaternion)
    }
  }

  private makeMushroomsAndFerns(): void {
    const stemGeometry = new THREE.CylinderGeometry(0.075, 0.11, 0.44, 7)
    const capGeometry = new THREE.SphereGeometry(0.31, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58)
    const stemMaterial = new THREE.MeshStandardMaterial({ color: '#c7ba9a', roughness: 0.95 })
    const glowingCaps = MUSHROOM_COLORS.map(color => new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.3, roughness: 0.7,
    }))
    const random = seeded(94107)
    let mushrooms = 0
    for (let i = 0; i < 42; i += 1) {
      const x = 98 + random() * 87
      const z = -41 + random() * 82
      if (distanceToSegment(x, z, this.spawn, this.keyPosition) < 3.2 || distanceToSegment(x, z, this.keyPosition, this.gatePosition) < 3.2) continue
      const scale = 0.5 + random() * 0.95
      const mushroom = new THREE.Group()
      mushroom.position.set(x, 0, z)
      mushroom.scale.setScalar(scale)
      const stem = new THREE.Mesh(stemGeometry, stemMaterial)
      stem.position.y = 0.22
      mushroom.add(stem)
      const cap = new THREE.Mesh(capGeometry, glowingCaps[i % glowingCaps.length])
      cap.position.y = 0.48
      cap.rotation.x = Math.PI
      cap.castShadow = true
      mushroom.add(cap)
      this.scene.add(mushroom)
      if (i % 7 === 0) {
        const glow = new THREE.PointLight(MUSHROOM_COLORS[i % MUSHROOM_COLORS.length], 0.65, 5.2, 2)
        glow.position.set(x, 0.8, z)
        this.scene.add(glow)
      }
      mushrooms += 1
    }

    const fernMaterial = new THREE.MeshStandardMaterial({ color: '#345c48', roughness: 1 })
    const fernGeometry = new THREE.ConeGeometry(0.14, 1.05, 4)
    for (let i = 0; i < 29; i += 1) {
      const x = 98 + random() * 87
      const z = -41 + random() * 82
      if (distanceToSegment(x, z, this.spawn, this.keyPosition) < 2.6 || distanceToSegment(x, z, this.keyPosition, this.gatePosition) < 2.6) continue
      const fern = new THREE.Group()
      fern.position.set(x, 0.18, z)
      for (let leaf = 0; leaf < 5; leaf += 1) {
        const blade = new THREE.Mesh(fernGeometry, fernMaterial)
        blade.position.y = 0.32
        blade.rotation.z = Math.PI * 0.5
        blade.rotation.y = leaf * Math.PI * 0.4
        blade.scale.set(0.72 + random() * 0.48, 0.82 + random() * 0.54, 0.6)
        fern.add(blade)
      }
      this.scene.add(fern)
    }
    this.scene.userData.mushroomCount = mushrooms
  }

  private makeForestKey(): void {
    const gold = new THREE.MeshStandardMaterial({ color: '#ffe18a', emissive: '#d58d25', emissiveIntensity: 0.72, metalness: 0.68, roughness: 0.27 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.065, 10, 22), gold)
    ring.position.set(0, 0.34, 0)
    ring.castShadow = true
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.52, 8), gold)
    shaft.position.set(0, -0.08, 0)
    shaft.castShadow = true
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.12), gold)
    tooth.position.set(0.12, -0.24, 0)
    tooth.castShadow = true
    const bow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), gold)
    bow.position.set(0, 0.34, 0)
    this.keyRoot.add(ring, shaft, tooth, bow)
    this.keyRoot.position.set(this.keyPosition.x, 1.02, this.keyPosition.z)
    this.keyRoot.name = 'Forest Key'
    const keyLight = new THREE.PointLight('#ffd778', 1.55, 8, 1.8)
    keyLight.position.y = 0.2
    this.keyRoot.add(keyLight)
    this.scene.add(this.keyRoot)

    const sparkleGeometry = new THREE.OctahedronGeometry(0.09, 0)
    const sparkleMaterial = new THREE.MeshBasicMaterial({ color: '#fff2b6', toneMapped: false })
    for (let i = 0; i < 6; i += 1) {
      const sparkle = new THREE.Mesh(sparkleGeometry, sparkleMaterial)
      const angle = i / 6 * Math.PI * 2
      sparkle.position.set(Math.cos(angle) * (0.48 + (i % 2) * 0.12), 0.42, Math.sin(angle) * (0.48 + (i % 2) * 0.12))
      this.keySparkles.add(sparkle)
    }
    this.keyRoot.add(this.keySparkles)
  }

  private makeGardenGate(): void {
    const darkWood = new THREE.MeshStandardMaterial({ color: '#4a372d', roughness: 0.92 })
    const warmWood = new THREE.MeshStandardMaterial({ color: '#74513a', roughness: 0.85 })
    this.gateGoldMaterial = new THREE.MeshStandardMaterial({ color: '#d7a853', emissive: '#f4ac37', emissiveIntensity: 0.08, roughness: 0.54, metalness: 0.18 })
    const postGeometry = new THREE.BoxGeometry(0.58, 4.5, 0.58)
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, darkWood)
      post.position.set(this.gatePosition.x, 2.25, side * 4.2)
      post.castShadow = true
      this.scene.add(post)
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 4), this.gateGoldMaterial)
      cap.position.set(this.gatePosition.x, 4.85, side * 4.2)
      cap.rotation.y = Math.PI / 4
      this.scene.add(cap)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 9.1), darkWood)
    lintel.position.set(this.gatePosition.x, 4.4, 0)
    lintel.castShadow = true
    this.scene.add(lintel)

    this.leftGate.position.set(this.gatePosition.x, 0, -4.0)
    this.rightGate.position.set(this.gatePosition.x, 0, 4.0)
    const doorGeometry = new THREE.BoxGeometry(0.32, 3.4, 4.0)
    const addDoor = (pivot: THREE.Group, direction: 1 | -1) => {
      const leaf = new THREE.Group()
      leaf.position.z = direction * 2
      const panel = new THREE.Mesh(doorGeometry, warmWood)
      panel.castShadow = true
      leaf.add(panel)
      for (let bar = -1; bar <= 1; bar += 1) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.2, 3.75), this.gateGoldMaterial)
        rail.position.set(0, bar * 1.04, 0)
        leaf.add(rail)
      }
      const centerRail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.85, 0.26), darkWood)
      centerRail.position.y = 0
      leaf.add(centerRail)
      pivot.add(leaf)
    }
    addDoor(this.leftGate, 1)
    addDoor(this.rightGate, -1)
    this.scene.add(this.leftGate, this.rightGate)

    const signTexture = makeGateSignTexture()
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 0.86),
      new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, side: THREE.DoubleSide }),
    )
    sign.position.set(this.gatePosition.x - 0.34, 3.55, 0)
    // The player approaches from the low-X side; face the readable side toward that approach.
    sign.rotation.y = -Math.PI / 2
    this.scene.add(sign)

    this.gateGoldLight = new THREE.PointLight('#ffc65c', 0.2, 9, 1.7)
    this.gateGoldLight.position.set(this.gatePosition.x + 1.1, 1.8, 0)
    this.scene.add(this.gateGoldLight)
    this.gateCollider = this.physics.addStaticBox(
      new THREE.Vector3(this.gatePosition.x + 0.7, 1.6, this.gatePosition.z),
      new THREE.Vector3(0.9, 3.2, 8.4),
    )
  }
}

function makeGateSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 144
  const context = canvas.getContext('2d')!
  context.fillStyle = '#312920'
  context.fillRect(4, 4, 632, 136)
  context.strokeStyle = '#e6bb69'
  context.lineWidth = 8
  context.strokeRect(10, 10, 620, 124)
  context.fillStyle = '#ffdfa0'
  context.font = 'bold 48px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('GARDEN GATE', 320, 74)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function distanceToSegment(x: number, z: number, start: THREE.Vector3, end: THREE.Vector3): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  const t = THREE.MathUtils.clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1)
  return Math.hypot(x - (start.x + t * dx), z - (start.z + t * dz))
}

function seededValue(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123
  return x - Math.floor(x)
}

function seeded(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
