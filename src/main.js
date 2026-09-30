import * as THREE from 'three'
import './style.css'
import { LinepoolApp } from './app.js'

const container = document.querySelector('#app')
const fallback = document.querySelector('#webgl-fallback')

try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.setClearColor(0x0a0a0f, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.setAttribute('aria-label', 'LINEPOOL 交互式三维界面')
  renderer.domElement.tabIndex = 0
  container.append(renderer.domElement)

  const app = new LinepoolApp({
    renderer,
    a11yRoot: document.querySelector('#a11y-root'),
  })
  app.start()
} catch (error) {
  console.error('WebGL initialization failed', error)
  fallback.hidden = false
}
