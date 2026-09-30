import * as THREE from 'three'
import { gsap } from 'gsap'
import { AccessibilityBridge } from './core/a11y.js'
import { InteractionManager } from './core/interaction.js'
import { createDemoState } from './state/store.js'
import {
  COLORS,
  addButton,
  addIconLabel,
  addLine,
  addPill,
  addRect,
  addText,
} from './ui/primitives.js'
import { createIcon } from './ui/icons.js'

const NAV_ITEMS = [
  { route: 'home', label: '首页', icon: 'dashboard' },
  { route: 'market', label: '项目市场', icon: 'store' },
  { route: 'numbers', label: '我的号码', icon: 'phone' },
  { route: 'orders', label: '订单', icon: 'orders' },
  { route: 'inbox', label: '短信收件箱', icon: 'inbox' },
  { route: 'account', label: '积分 / 账户', icon: 'wallet' },
]

export class LinepoolApp {
  constructor({ renderer, a11yRoot }) {
    this.renderer = renderer
    this.canvas = renderer.domElement
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2400)
    this.camera.position.set(0, 0, 1000)
    this.interaction = new InteractionManager({ canvas: this.canvas, camera: this.camera })
    this.a11y = new AccessibilityBridge(a11yRoot, (message) => this.showToast(message))
    this.state = createDemoState()
    this.currentPage = null
    this.toast = null
    this.loginAccount = 'demo@linepool.local'
    this.pointerTarget = new THREE.Vector2()
    this.pointerSmooth = new THREE.Vector2()
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.clock = new THREE.Clock()
    this.background = this.createBackground()
    this.scene.add(this.background)
  }

  start() {
    this.handleResize()
    window.addEventListener('resize', () => this.handleResize())
    window.addEventListener('hashchange', () => this.renderRoute())
    window.addEventListener('pointermove', (event) => {
      this.pointerTarget.set(
        (event.clientX / window.innerWidth - 0.5) * 2,
        (event.clientY / window.innerHeight - 0.5) * 2,
      )
    })
    if (!window.location.hash) window.location.hash = '#/login'
    this.renderRoute()
    this.renderer.setAnimationLoop(() => this.renderFrame())
  }

  handleResize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.camera.left = -this.width / 2
    this.camera.right = this.width / 2
    this.camera.top = this.height / 2
    this.camera.bottom = -this.height / 2
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.width, this.height, false)
    if (this.currentPage) this.renderRoute({ instant: true })
  }

  renderFrame() {
    const elapsed = this.clock.getElapsedTime()
    this.pointerSmooth.lerp(this.pointerTarget, this.reduceMotion ? 0 : 0.035)
    this.camera.position.x = this.pointerSmooth.x * 7
    this.camera.position.y = -this.pointerSmooth.y * 5
    this.camera.lookAt(0, 0, 0)
    this.background.rotation.z = Math.sin(elapsed * 0.08) * 0.008
    this.renderer.render(this.scene, this.camera)
  }

  getRoute() {
    return window.location.hash.replace(/^#\/?/, '') || 'login'
  }

  navigate(route) {
    const next = `#/${route}`
    if (window.location.hash === next) this.renderRoute()
    else window.location.hash = next
  }

  renderRoute({ instant = false } = {}) {
    const route = this.getRoute()
    this.interaction.clear()
    const next = new THREE.Group()
    next.userData.route = route

    if (route === 'login') this.buildLogin(next)
    else {
      this.buildShell(next, route)
      if (route === 'home') this.buildHome(next)
      else this.buildPlaceholder(next, route)
    }

    this.scene.add(next)
    const previous = this.currentPage
    this.currentPage = next

    if (instant || this.reduceMotion || !previous) {
      if (previous) this.disposeGroup(previous)
      return
    }

    next.position.set(70, 0, -80)
    next.scale.setScalar(0.985)
    gsap.to(next.position, { x: 0, z: 0, duration: 0.72, ease: 'power3.out' })
    gsap.to(next.scale, { x: 1, y: 1, z: 1, duration: 0.72, ease: 'power3.out' })
    gsap.to(previous.position, {
      x: -50,
      z: -120,
      duration: 0.36,
      ease: 'power2.in',
      onComplete: () => this.disposeGroup(previous),
    })
  }

  disposeGroup(group) {
    this.scene.remove(group)
    group.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.())
      else object.material?.dispose?.()
      if (object.isTroikaText) object.dispose?.()
    })
  }

  createBackground() {
    const group = new THREE.Group()
    group.position.z = -500
    const positions = []
    for (let index = 0; index < 160; index += 1) {
      const x = ((index * 79) % 997) / 997 - 0.5
      const y = ((index * 43) % 887) / 887 - 0.5
      positions.push(x * 2300, y * 1300, -((index * 31) % 240))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0x3d4864, size: 1.7, transparent: true, opacity: 0.48 }),
    )
    group.add(points)

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(260, 262, 96),
      new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.055, side: THREE.DoubleSide }),
    )
    halo.position.set(this.width * 0.25 || 300, 40, -40)
    group.add(halo)
    return group
  }

  buildLogin(page) {
    const left = -this.width / 2 + 96
    const top = this.height / 2 - 72
    this.a11y.reset('LINEPOOL 演示登录', '使用演示账号进入纯 WebGL 桌面端交互原型。')

    addText(page, 'LINEPOOL', {
      x: left,
      y: top,
      size: 17,
      color: COLORS.text,
      letterSpacing: 0.12,
      weight: 700,
    })
    addPill(page, 'WEBGL PROTOTYPE', left + 188, top, {
      width: 148,
      color: 0x14213b,
      textColor: COLORS.blueBright,
    })

    const visualLeft = -this.width * 0.28
    addText(page, '号码连接世界，\n验证发生在此刻。', {
      x: visualLeft,
      y: 94,
      size: Math.max(38, Math.min(54, this.width * 0.035)),
      color: COLORS.text,
      lineHeight: 1.18,
      weight: 650,
    })
    addText(page, '面向个人用户的号码与短信验证空间。\n这是完全独立的演示数据环境。', {
      x: visualLeft,
      y: -28,
      size: 15,
      color: COLORS.textMuted,
      lineHeight: 1.7,
    })
    addLine(page, visualLeft, -116, visualLeft + 160, -116, COLORS.blue, 0.85)
    addText(page, '01 — ENTER THE POOL', {
      x: visualLeft,
      y: -142,
      size: 11,
      color: COLORS.textSoft,
      letterSpacing: 0.14,
    })

    const cardX = this.width * 0.25
    const card = addRect(page, {
      x: cardX,
      y: 0,
      width: 410,
      height: 500,
      radius: 18,
      color: COLORS.surface,
      borderColor: COLORS.border,
      borderOpacity: 0.9,
    })
    addPill(card, '演示数据', -132, 198, {
      width: 84,
      color: 0x14213b,
      textColor: COLORS.blueBright,
    })
    addText(card, '欢迎回来', { x: -156, y: 136, size: 28, weight: 650 })
    addText(card, '无需真实账号，输入任意昵称即可进入。', {
      x: -156,
      y: 98,
      size: 13,
      color: COLORS.textMuted,
    })
    addText(card, '演示账号', { x: -156, y: 42, size: 12, color: COLORS.textMuted })

    const input = addRect(card, {
      x: 0,
      y: -2,
      width: 312,
      height: 52,
      radius: 8,
      color: COLORS.surfaceSoft,
      borderColor: COLORS.borderStrong,
    })
    const inputLabel = addText(input, this.loginAccount, {
      x: -136,
      y: 0,
      z: 2,
      size: 14,
      color: COLORS.text,
      maxWidth: 258,
    })
    const nativeInput = this.a11y.addInput('演示账号', this.loginAccount, (value) => {
      this.loginAccount = value
      inputLabel.text = value || '请输入账号'
      inputLabel.color = value ? COLORS.text : COLORS.textSoft
      inputLabel.sync()
    })
    this.interaction.register(input.userData.surface, {
      group: input,
      label: '演示账号输入框',
      onClick: () => nativeInput.focus(),
    })

    const enter = () => {
      this.showToast(`欢迎，${this.loginAccount || '演示用户'}`)
      this.navigate('home')
    }
    addButton(card, this.interaction, {
      label: '进入 LINEPOOL',
      x: 0,
      y: -82,
      width: 312,
      height: 52,
      icon: 'arrowRight',
      onClick: enter,
    })
    this.a11y.addButton('进入 LINEPOOL', enter)

    addLine(card, -156, -138, 156, -138, COLORS.border, 0.8)
    addIconLabel(card, 'check', '不连接公司接口', -144, -174, COLORS.textMuted)
    addIconLabel(card, 'check', '不保存真实凭据', 24, -174, COLORS.textMuted)
    addText(card, '建议使用 1280–1920px 桌面视口', {
      x: 0,
      y: -220,
      size: 11,
      color: COLORS.textSoft,
      anchorX: 'center',
    })
  }

  buildShell(page, route) {
    const left = -this.width / 2
    const top = this.height / 2
    const sidebarWidth = 220
    addRect(page, {
      x: left + sidebarWidth / 2 + 24,
      y: 0,
      width: sidebarWidth,
      height: this.height - 48,
      radius: 16,
      color: 0x0e0f15,
      borderColor: COLORS.border,
      borderOpacity: 0.65,
    })
    addText(page, 'LINEPOOL', {
      x: left + 62,
      y: top - 72,
      size: 15,
      letterSpacing: 0.1,
      weight: 700,
    })
    addPill(page, 'DEMO', left + 176, top - 72, { width: 58, color: 0x14213b, textColor: COLORS.blueBright })

    NAV_ITEMS.forEach((item, index) => {
      const active = route === item.route || (route.startsWith('project/') && item.route === 'market')
      const nav = addRect(page, {
        x: left + 134,
        y: top - 140 - index * 54,
        width: 176,
        height: 42,
        radius: 8,
        color: active ? 0x17223a : 0x0e0f15,
        borderColor: active ? 0x284f91 : 0x0e0f15,
        borderOpacity: active ? 0.9 : 0,
      })
      const icon = createIcon(item.icon, { size: 17, color: active ? COLORS.blueBright : COLORS.textSoft })
      icon.position.set(-64, 0, 2)
      nav.add(icon)
      addText(nav, item.label, {
        x: -40,
        y: 0,
        z: 2,
        size: 13,
        color: active ? COLORS.text : COLORS.textMuted,
        weight: active ? 600 : 400,
      })
      this.interaction.register(nav.userData.surface, {
        group: nav,
        label: `前往${item.label}`,
        onClick: () => this.navigate(item.route),
      })
    })

    addLine(page, left + 52, -top + 128, left + 216, -top + 128, COLORS.border, 0.75)
    const avatar = addRect(page, {
      x: left + 78,
      y: -top + 82,
      width: 40,
      height: 40,
      radius: 20,
      color: 0x1a2b4d,
    })
    addText(avatar, '林', { x: 0, y: 0, z: 2, size: 14, color: COLORS.blueBright, anchorX: 'center', weight: 700 })
    addText(page, this.state.user.name, { x: left + 110, y: -top + 88, size: 13, weight: 600 })
    addText(page, this.state.user.level, { x: left + 110, y: -top + 68, size: 10, color: COLORS.textSoft })
  }

  buildHome(page) {
    const left = -this.width / 2 + 284
    const right = this.width / 2 - 48
    const top = this.height / 2 - 62
    const contentWidth = right - left
    this.a11y.reset('LINEPOOL 首页', '查看积分、号码和推荐项目。')
    NAV_ITEMS.forEach((item) => this.a11y.addButton(`前往${item.label}`, () => this.navigate(item.route)))

    addText(page, '工作台', { x: left, y: top, size: 12, color: COLORS.textSoft, letterSpacing: 0.1 })
    addText(page, `上午好，${this.state.user.name}`, { x: left, y: top - 40, size: 30, weight: 650 })
    addText(page, '今天也从一个清晰的验证任务开始。', { x: left, y: top - 76, size: 14, color: COLORS.textMuted })

    const heroWidth = contentWidth * 0.64
    const hero = addRect(page, {
      x: left + heroWidth / 2,
      y: top - 218,
      width: heroWidth,
      height: 212,
      radius: 16,
      color: 0x111827,
      borderColor: 0x263651,
    })
    addPill(hero, 'START HERE', -heroWidth / 2 + 74, 72, { width: 102, color: 0x17305b, textColor: COLORS.blueBright })
    addText(hero, '从项目市场选择\n下一条号码通道', {
      x: -heroWidth / 2 + 32,
      y: 22,
      size: 24,
      lineHeight: 1.35,
      weight: 600,
    })
    addButton(hero, this.interaction, {
      label: '浏览项目',
      x: -heroWidth / 2 + 104,
      y: -69,
      width: 144,
      height: 42,
      icon: 'arrowRight',
      onClick: () => this.navigate('market'),
    })
    const sparkle = createIcon('sparkles', { size: 92, color: 0x4776ca, opacity: 0.45 })
    sparkle.position.set(heroWidth / 2 - 108, 0, 2)
    sparkle.rotation.z = -0.12
    hero.add(sparkle)

    const balanceWidth = contentWidth - heroWidth - 24
    const balance = addRect(page, {
      x: right - balanceWidth / 2,
      y: top - 218,
      width: balanceWidth,
      height: 212,
      radius: 16,
      color: COLORS.surface,
      borderColor: COLORS.border,
    })
    addText(balance, '积分余额', { x: -balanceWidth / 2 + 28, y: 70, size: 12, color: COLORS.textMuted })
    addText(balance, this.state.user.points.toLocaleString('zh-CN'), {
      x: -balanceWidth / 2 + 28,
      y: 24,
      size: 34,
      weight: 600,
    })
    addText(balance, 'P', { x: -balanceWidth / 2 + 32 + String(this.state.user.points).length * 21, y: 22, size: 12, color: COLORS.blueBright })
    addLine(balance, -balanceWidth / 2 + 28, -16, balanceWidth / 2 - 28, -16, COLORS.border)
    addText(balance, '活跃号码', { x: -balanceWidth / 2 + 28, y: -50, size: 11, color: COLORS.textSoft })
    addText(balance, String(this.state.numbers.filter((item) => item.status !== '已归档').length), {
      x: balanceWidth / 2 - 28,
      y: -50,
      size: 18,
      anchorX: 'right',
      weight: 600,
    })
    addText(balance, '未读短信', { x: -balanceWidth / 2 + 28, y: -80, size: 11, color: COLORS.textSoft })
    addText(balance, String(this.state.messages.filter((item) => !item.read).length), {
      x: balanceWidth / 2 - 28,
      y: -80,
      size: 18,
      color: COLORS.blueBright,
      anchorX: 'right',
      weight: 600,
    })

    addText(page, '推荐项目', { x: left, y: top - 372, size: 17, weight: 600 })
    addText(page, '基于当前演示数据', { x: left + 92, y: top - 372, size: 11, color: COLORS.textSoft })
    const gap = 18
    const cardWidth = (contentWidth - gap * 2) / 3
    this.state.projects.filter((item) => item.featured).forEach((project, index) => {
      const card = addRect(page, {
        x: left + cardWidth / 2 + index * (cardWidth + gap),
        y: top - 500,
        width: cardWidth,
        height: 198,
        radius: 14,
        color: COLORS.surface,
        borderColor: COLORS.border,
      })
      addText(card, project.code, { x: -cardWidth / 2 + 22, y: 70, size: 10, color: project.accent, letterSpacing: 0.08 })
      addText(card, project.name, { x: -cardWidth / 2 + 22, y: 32, size: 19, weight: 600 })
      addText(card, project.description, {
        x: -cardWidth / 2 + 22,
        y: -2,
        size: 11,
        color: COLORS.textMuted,
        maxWidth: cardWidth - 44,
        lineHeight: 1.55,
      })
      addPill(card, project.region, -cardWidth / 2 + 52, -68, { width: 60 })
      addText(card, `${project.availability}% 可用`, { x: cardWidth / 2 - 22, y: -68, size: 11, color: COLORS.textSoft, anchorX: 'right' })
      this.interaction.register(card.userData.surface, {
        group: card,
        label: `查看${project.name}`,
        onClick: () => this.navigate(`project/${project.id}`),
      })
      this.a11y.addButton(`查看${project.name}`, () => this.navigate(`project/${project.id}`))
    })
  }

  buildPlaceholder(page, route) {
    const item = NAV_ITEMS.find((entry) => entry.route === route)
    const left = -this.width / 2 + 284
    const top = this.height / 2 - 78
    const title = item?.label || (route.startsWith('project/') ? '项目详情' : '页面')
    this.a11y.reset(title, '该页面正在连接到 WebGL 场景。')
    NAV_ITEMS.forEach((nav) => this.a11y.addButton(`前往${nav.label}`, () => this.navigate(nav.route)))
    addText(page, title, { x: left, y: top, size: 30, weight: 650 })
    addText(page, '场景正在搭建中 · 演示数据', { x: left, y: top - 42, size: 13, color: COLORS.textMuted })
    addRect(page, {
      x: left + 340,
      y: 0,
      width: 680,
      height: 280,
      radius: 16,
      color: COLORS.surface,
      borderColor: COLORS.border,
    })
    addText(page, '保持在同一空间语言中', { x: left + 40, y: 40, size: 21, weight: 600 })
    addText(page, '下一增量将填充完整业务内容与状态交互。', { x: left + 40, y: 0, size: 13, color: COLORS.textMuted })
  }

  showToast(message) {
    if (!message) return
    if (this.toast) this.disposeGroup(this.toast)
    const toast = new THREE.Group()
    toast.position.set(this.width / 2 - 224, this.height / 2 - 58, 120)
    addRect(toast, {
      width: 344,
      height: 48,
      radius: 10,
      color: 0x182239,
      borderColor: 0x325995,
    })
    addText(toast, message, { x: -148, y: 0, z: 3, size: 12, color: COLORS.text })
    this.scene.add(toast)
    this.toast = toast
    if (!this.reduceMotion) {
      toast.position.y += 18
      gsap.to(toast.position, { y: this.height / 2 - 58, duration: 0.32, ease: 'power2.out' })
    }
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      if (this.toast === toast) {
        this.disposeGroup(toast)
        this.toast = null
      }
    }, 2600)

    const status = document.createElement('div')
    status.setAttribute('role', 'status')
    status.textContent = message
    this.a11y.root.append(status)
  }
}
