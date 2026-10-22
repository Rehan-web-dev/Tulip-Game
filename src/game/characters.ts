import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

const mat = (color: THREE.ColorRepresentation, roughness = 0.82) => new THREE.MeshStandardMaterial({ color, roughness })

function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale?: [number, number, number], rotation?: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  if (scale) mesh.scale.set(...scale)
  if (rotation) mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function capsule(radius: number, length: number, material: THREE.Material, parent: THREE.Object3D, position: [number, number, number], scale?: [number, number, number], rotation?: [number, number, number]): THREE.Mesh {
  return part(parent, new THREE.CapsuleGeometry(radius, length, 4, 8), material, position, scale, rotation)
}

/** A small, graphic Raven-inspired avatar with her hood, plum cloak and red gem. */
export function createRavenCharacter(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Raven — playable character'
  const robe = mat('#30264c')
  const plum = mat('#7250a8')
  const dark = mat('#171623')
  const skin = mat('#f0d4d5', 0.72)
  const hair = mat('#382a73')
  const red = new THREE.MeshStandardMaterial({ color: '#d94d67', emissive: '#a51c46', emissiveIntensity: 0.35, roughness: 0.3 })
  const eye = mat('#35233e', 0.4)

  part(root, new THREE.ConeGeometry(0.51, 1.35, 8), robe, [0, -0.22, 0.14], [1, 1, 0.55])
  part(root, new THREE.CylinderGeometry(0.25, 0.34, 0.74, 8), dark, [0, -0.12, 0])
  part(root, new THREE.CylinderGeometry(0.25, 0.45, 0.36, 8), plum, [0, -0.52, 0])
  capsule(0.085, 0.42, robe, root, [-0.31, -0.14, 0], [1, 1, 1], [0, 0, -0.23])
  capsule(0.085, 0.42, robe, root, [0.31, -0.14, 0], [1, 1, 1], [0, 0, 0.23])
  part(root, new THREE.CylinderGeometry(0.075, 0.09, 0.35, 6), dark, [-0.14, -0.79, -0.01])
  part(root, new THREE.CylinderGeometry(0.075, 0.09, 0.35, 6), dark, [0.14, -0.79, -0.01])
  part(root, new THREE.BoxGeometry(0.2, 0.1, 0.31), dark, [-0.14, -0.94, -0.05])
  part(root, new THREE.BoxGeometry(0.2, 0.1, 0.31), dark, [0.14, -0.94, -0.05])
  const belt = part(root, new THREE.TorusGeometry(0.27, 0.045, 6, 18), plum, [0, -0.36, -0.01])
  belt.rotation.x = Math.PI / 2
  part(root, new THREE.OctahedronGeometry(0.09, 0), red, [0, -0.36, -0.28], [0.75, 1.05, 0.55])

  part(root, new THREE.SphereGeometry(0.31, 12, 10), skin, [0, 0.47, -0.01], [0.92, 1.05, 0.88])
  part(root, new THREE.SphereGeometry(0.39, 12, 9), robe, [0, 0.56, 0.03], [1.14, 1.06, 1.04])
  // The open front of the hood frames her face rather than hiding it.
  part(root, new THREE.SphereGeometry(0.3, 10, 8), skin, [0, 0.46, -0.245], [0.84, 0.8, 0.43])
  part(root, new THREE.SphereGeometry(0.36, 10, 8), hair, [0, 0.69, -0.13], [1.06, 0.42, 0.72])
  part(root, new THREE.ConeGeometry(0.085, 0.34, 5), hair, [-0.17, 0.34, -0.24], [1, 1, 0.7], [0.24, 0, -0.18])
  part(root, new THREE.ConeGeometry(0.085, 0.34, 5), hair, [0.17, 0.34, -0.24], [1, 1, 0.7], [0.24, 0, 0.18])
  part(root, new THREE.SphereGeometry(0.033, 8, 6), eye, [-0.09, 0.48, -0.34])
  part(root, new THREE.SphereGeometry(0.033, 8, 6), eye, [0.09, 0.48, -0.34])
  part(root, new THREE.ConeGeometry(0.075, 0.28, 5), plum, [0, 0.98, 0.08], [1, 1, 0.8])
  return root
}

/** Snowball: the tiny white rabbit companion, with pink ears and a violet collar. */
export function createSnowball(): THREE.Group {
  const root = createGardenBunny(1, '#fffaf2')
  root.name = 'Snowball — companion'
  const violet = mat('#7750a2')
  part(root, new THREE.TorusGeometry(0.23, 0.055, 6, 16), violet, [0, 0.45, 0.02])
  part(root, new THREE.SphereGeometry(0.09, 8, 6), mat('#e65d89'), [0, 0.58, -0.34], [1.2, 0.75, 0.75])
  return root
}

/** Beast Boy-inspired garden NPC. */
export function createBeastBoy(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Beast Boy — garden friend'
  const green = mat('#79c85b')
  const suit = mat('#29223d')
  const violet = mat('#694c9a')
  const dark = mat('#1b1728')
  const eye = mat('#f8f6e7', 0.5)
  part(root, new THREE.CapsuleGeometry(0.24, 0.42, 4, 8), suit, [0, 0.75, 0])
  part(root, new THREE.CylinderGeometry(0.08, 0.09, 0.36, 7), green, [-0.3, 0.78, 0], [1, 1, 1], [0, 0, -0.3])
  part(root, new THREE.CylinderGeometry(0.08, 0.09, 0.36, 7), green, [0.3, 0.78, 0], [1, 1, 1], [0, 0, 0.3])
  part(root, new THREE.CylinderGeometry(0.1, 0.1, 0.36, 6), suit, [-0.13, 0.23, 0])
  part(root, new THREE.CylinderGeometry(0.1, 0.1, 0.36, 6), suit, [0.13, 0.23, 0])
  const belt = part(root, new THREE.TorusGeometry(0.23, 0.035, 5, 16), violet, [0, 0.54, 0])
  belt.rotation.x = Math.PI / 2
  part(root, new THREE.SphereGeometry(0.28, 12, 10), green, [0, 1.43, 0])
  part(root, new THREE.SphereGeometry(0.29, 10, 7), dark, [0, 1.62, 0.04], [1.1, 0.52, 1])
  part(root, new THREE.ConeGeometry(0.09, 0.23, 5), green, [-0.3, 1.42, 0], [0.7, 1, 0.55], [0, 0, 0.55])
  part(root, new THREE.ConeGeometry(0.09, 0.23, 5), green, [0.3, 1.42, 0], [0.7, 1, 0.55], [0, 0, -0.55])
  part(root, new THREE.SphereGeometry(0.035, 8, 6), eye, [-0.09, 1.44, -0.25])
  part(root, new THREE.SphereGeometry(0.035, 8, 6), eye, [0.09, 1.44, -0.25])
  part(root, new THREE.SphereGeometry(0.018, 6, 4), dark, [-0.09, 1.44, -0.281])
  part(root, new THREE.SphereGeometry(0.018, 6, 4), dark, [0.09, 1.44, -0.281])
  return root
}

/** Shared bunny silhouette; the garden's hopping rabbits vary only by scale and fur tint. */
export function createGardenBunny(scale = 1, furColor: THREE.ColorRepresentation = '#fffaf2'): THREE.Group {
  const root = new THREE.Group()
  const fur = mat(furColor, 0.93)
  const inner = mat('#efa0ad', 0.75)
  const dark = mat('#392d43', 0.44)
  const nose = mat('#ec708d', 0.5)
  part(root, new THREE.SphereGeometry(0.28, 10, 8), fur, [0, 0.31, 0.04], [1.12, 0.88, 1.16])
  part(root, new THREE.SphereGeometry(0.22, 10, 8), fur, [0, 0.57, -0.13], [1, 0.95, 0.95])
  capsule(0.06, 0.35, fur, root, [-0.1, 0.96, -0.14], [0.82, 1.14, 0.65], [0, 0, -0.08])
  capsule(0.06, 0.35, fur, root, [0.1, 0.96, -0.14], [0.82, 1.14, 0.65], [0, 0, 0.08])
  capsule(0.034, 0.25, inner, root, [-0.1, 0.96, -0.19], [0.72, 0.95, 0.45], [0, 0, -0.08])
  capsule(0.034, 0.25, inner, root, [0.1, 0.96, -0.19], [0.72, 0.95, 0.45], [0, 0, 0.08])
  part(root, new THREE.SphereGeometry(0.027, 7, 5), dark, [-0.08, 0.59, -0.318])
  part(root, new THREE.SphereGeometry(0.027, 7, 5), dark, [0.08, 0.59, -0.318])
  part(root, new THREE.SphereGeometry(0.036, 7, 5), nose, [0, 0.52, -0.34], [1, 0.8, 0.75])
  part(root, new THREE.SphereGeometry(0.09, 8, 6), fur, [0, 0.22, 0.34])
  root.scale.setScalar(scale)
  return root
}

/** Clone, fit and shadow-enable an imported model without changing the GLTF asset or gameplay pivot. */
export function fitCharacterModel(source: THREE.Object3D, targetHeight: number, pivot: 'center' | 'floor'): THREE.Group {
  const fitted = new THREE.Group()
  fitted.name = 'Fitted character'
  const model = cloneSkinned(source)
  model.updateMatrixWorld(true)
  let bounds = new THREE.Box3().setFromObject(model)
  const height = bounds.getSize(new THREE.Vector3()).y
  if (!Number.isFinite(height) || height <= 1e-3) return fitted

  model.scale.multiplyScalar(targetHeight / height)
  model.updateMatrixWorld(true)
  bounds = new THREE.Box3().setFromObject(model)
  const center = bounds.getCenter(new THREE.Vector3())
  model.position.x -= center.x
  model.position.z -= center.z
  model.position.y -= pivot === 'center' ? center.y : bounds.min.y
  model.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  fitted.add(model)
  return fitted
}
