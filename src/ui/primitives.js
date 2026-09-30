import * as THREE from 'three'
import { Text } from 'troika-three-text'
import { createIcon } from './icons.js'

export const COLORS = {
  bg: 0x0a0a0f,
  surface: 0x12131a,
  surfaceRaised: 0x191b24,
  surfaceSoft: 0x101219,
  border: 0x282b36,
  borderStrong: 0x3b4050,
  text: 0xf4f7fb,
  textMuted: 0x939cac,
  textSoft: 0x626b7a,
  blue: 0x3b82f6,
  blueBright: 0x69a3ff,
  green: 0x29c8a8,
  orange: 0xf5a85b,
  red: 0xe96f8d,
}

export const FONT_URL = '/fonts/NotoSansCJKsc-Regular.otf'

function roundedRectShape(width, height, radius) {
  const x = -width / 2
  const y = -height / 2
  const r = Math.min(radius, width / 2, height / 2)
  const shape = new THREE.Shape()
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return shape
}

export function addRect(parent, {
  x = 0,
  y = 0,
  z = 0,
  width,
  height,
  radius = 12,
  color = COLORS.surface,
  opacity = 1,
  borderColor,
  borderOpacity = 1,
  borderWidth = 1,
} = {}) {
  const group = new THREE.Group()
  group.position.set(x, y, z)

  if (borderColor !== undefined && borderWidth > 0) {
    const border = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedRectShape(width + borderWidth * 2, height + borderWidth * 2, radius + borderWidth)),
      new THREE.MeshBasicMaterial({
        color: borderColor,
        transparent: true,
        opacity: borderOpacity,
        depthWrite: false,
      }),
    )
    border.position.z = -0.2
    border.renderOrder = 2
    group.add(border)
  }

  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRectShape(width, height, radius)),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  mesh.renderOrder = 3
  group.add(mesh)
  group.userData.surface = mesh
  parent.add(group)
  return group
}

export function addText(parent, text, {
  x = 0,
  y = 0,
  z = 1,
  size = 16,
  color = COLORS.text,
  opacity = 1,
  maxWidth = Infinity,
  anchorX = 'left',
  anchorY = 'middle',
  align = 'left',
  lineHeight = 1.35,
  letterSpacing = 0,
  weight = 'normal',
} = {}) {
  const label = new Text()
  label.font = FONT_URL
  label.text = String(text)
  label.fontSize = size
  label.color = color
  label.fillOpacity = opacity
  label.maxWidth = maxWidth
  label.anchorX = anchorX
  label.anchorY = anchorY
  label.textAlign = align
  label.lineHeight = lineHeight
  label.letterSpacing = letterSpacing
  label.fontWeight = weight
  label.position.set(x, y, z)
  label.depthOffset = -2
  label.renderOrder = 10
  label.sync()
  parent.add(label)
  return label
}

export function addLine(parent, x1, y1, x2, y2, color = COLORS.border, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x1, y1, 1),
    new THREE.Vector3(x2, y2, 1),
  ])
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  )
  line.renderOrder = 6
  parent.add(line)
  return line
}

export function addButton(parent, interaction, {
  label,
  x,
  y,
  width,
  height = 44,
  icon,
  variant = 'primary',
  onClick,
  disabled = false,
  ariaLabel,
} = {}) {
  const variants = {
    primary: { color: COLORS.blue, text: 0xffffff, border: COLORS.blue },
    secondary: { color: COLORS.surfaceRaised, text: COLORS.text, border: COLORS.borderStrong },
    ghost: { color: COLORS.surfaceSoft, text: COLORS.textMuted, border: COLORS.border },
    danger: { color: 0x2a1821, text: 0xff9bb2, border: 0x663040 },
  }
  const palette = variants[variant]
  const group = addRect(parent, {
    x,
    y,
    width,
    height,
    radius: 8,
    color: disabled ? COLORS.surfaceSoft : palette.color,
    borderColor: disabled ? COLORS.border : palette.border,
    borderOpacity: 0.9,
  })
  const textOffset = icon ? 10 : 0

  if (icon) {
    const iconGroup = createIcon(icon, {
      size: 17,
      color: disabled ? COLORS.textSoft : palette.text,
    })
    iconGroup.position.set(-width / 2 + 20, 0, 2)
    group.add(iconGroup)
  }

  addText(group, label, {
    x: textOffset,
    y: 0,
    z: 2,
    size: 13,
    color: disabled ? COLORS.textSoft : palette.text,
    anchorX: 'center',
    weight: 600,
  })

  if (!disabled && onClick) {
    interaction.register(group.userData.surface, {
      group,
      label: ariaLabel || label,
      onClick,
    })
  }

  return group
}

export function addPill(parent, label, x, y, {
  color = COLORS.surfaceRaised,
  textColor = COLORS.textMuted,
  width = Math.max(62, label.length * 14 + 24),
} = {}) {
  const pill = addRect(parent, { x, y, width, height: 26, radius: 13, color })
  addText(pill, label, { x: 0, y: 0, z: 2, size: 11, color: textColor, anchorX: 'center' })
  return pill
}

export function addIconLabel(parent, iconName, label, x, y, color = COLORS.textMuted) {
  const group = new THREE.Group()
  group.position.set(x, y, 2)
  const icon = createIcon(iconName, { size: 16, color })
  group.add(icon)
  addText(group, label, { x: 14, y: 0, size: 12, color })
  parent.add(group)
  return group
}
