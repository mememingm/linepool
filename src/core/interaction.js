import * as THREE from 'three'
import { gsap } from 'gsap'

export class InteractionManager {
  constructor({ canvas, camera }) {
    this.canvas = canvas
    this.camera = camera
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.items = []
    this.hovered = null
    this.enabled = true

    canvas.addEventListener('pointermove', (event) => this.handleMove(event))
    canvas.addEventListener('pointerdown', (event) => this.handleDown(event))
  }

  register(mesh, options) {
    mesh.userData.interaction = options
    this.items.push(mesh)
  }

  clear() {
    this.setHovered(null)
    this.items = []
  }

  hitTest(event) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.intersectObjects(this.items, false)[0]?.object || null
  }

  setHovered(mesh) {
    if (this.hovered === mesh) return
    if (this.hovered) {
      const previous = this.hovered.userData.interaction
      gsap.to(previous.group.position, { z: 0, duration: 0.18, ease: 'power2.out' })
      gsap.to(previous.group.scale, { x: 1, y: 1, duration: 0.18, ease: 'power2.out' })
      previous.onLeave?.()
    }
    this.hovered = mesh
    if (mesh) {
      const next = mesh.userData.interaction
      gsap.to(next.group.position, { z: 12, duration: 0.2, ease: 'power2.out' })
      gsap.to(next.group.scale, { x: 1.012, y: 1.012, duration: 0.2, ease: 'power2.out' })
      next.onEnter?.()
    }
    this.canvas.style.cursor = mesh ? 'pointer' : 'default'
  }

  handleMove(event) {
    if (!this.enabled) return
    this.setHovered(this.hitTest(event))
  }

  handleDown(event) {
    if (!this.enabled) return
    const mesh = this.hitTest(event)
    mesh?.userData.interaction?.onClick?.(event)
  }
}
