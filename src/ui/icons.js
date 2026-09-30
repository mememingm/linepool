import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import dashboardSvg from 'lucide-static/icons/layout-dashboard.svg?raw'
import storeSvg from 'lucide-static/icons/store.svg?raw'
import phoneSvg from 'lucide-static/icons/smartphone.svg?raw'
import ordersSvg from 'lucide-static/icons/receipt-text.svg?raw'
import inboxSvg from 'lucide-static/icons/inbox.svg?raw'
import walletSvg from 'lucide-static/icons/wallet-cards.svg?raw'
import userSvg from 'lucide-static/icons/circle-user-round.svg?raw'
import logoutSvg from 'lucide-static/icons/log-out.svg?raw'
import searchSvg from 'lucide-static/icons/search.svg?raw'
import arrowLeftSvg from 'lucide-static/icons/arrow-left.svg?raw'
import arrowRightSvg from 'lucide-static/icons/arrow-right.svg?raw'
import copySvg from 'lucide-static/icons/copy.svg?raw'
import chevronRightSvg from 'lucide-static/icons/chevron-right.svg?raw'
import plusSvg from 'lucide-static/icons/plus.svg?raw'
import minusSvg from 'lucide-static/icons/minus.svg?raw'
import checkSvg from 'lucide-static/icons/check.svg?raw'
import sparklesSvg from 'lucide-static/icons/sparkles.svg?raw'

const ICONS = {
  dashboard: dashboardSvg,
  store: storeSvg,
  phone: phoneSvg,
  orders: ordersSvg,
  inbox: inboxSvg,
  wallet: walletSvg,
  user: userSvg,
  logout: logoutSvg,
  search: searchSvg,
  arrowLeft: arrowLeftSvg,
  arrowRight: arrowRightSvg,
  copy: copySvg,
  chevronRight: chevronRightSvg,
  plus: plusSvg,
  minus: minusSvg,
  check: checkSvg,
  sparkles: sparklesSvg,
}

const loader = new SVGLoader()

export function createIcon(name, { size = 20, color = 0xb7c0d0, opacity = 1 } = {}) {
  const group = new THREE.Group()
  const svg = ICONS[name]
  if (!svg) return group

  const parsed = loader.parse(svg.replaceAll('currentColor', '#ffffff'))
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
  })
  const scale = size / 24

  parsed.paths.forEach((path) => {
    path.subPaths.forEach((subPath) => {
      const points = subPath.getPoints(20).map(
        (point) => new THREE.Vector3((point.x - 12) * scale, (-point.y + 12) * scale, 0),
      )
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const line = new THREE.Line(geometry, material.clone())
      line.renderOrder = 20
      group.add(line)
    })
  })

  return group
}
