import { scrollColumnsBy, type Detection } from './columns'
import { moveItem } from './order'

/**
 * ドラッグ操作のオーバーレイ。
 *
 * グリップ・ゴースト・挿入線はすべて body 直下の自前レイヤーに描き、Google の DOM には
 * `order` 以外何も足さない。掴んでいる列の実体は 5 つのコンテナに分散しているため、
 * ドラッグ中に本物を動かすのは諦めて、確定した瞬間に一度だけ並び替える。
 */

/** この幅の帯にカーソルが入ったら横スクロールを始める (px)。 */
const EDGE = 52

/** オートスクロールの 1 フレームあたりの最大量 (px)。 */
const MAX_STEP = 22

export type DragHost = {
  detection: () => Detection | null
  /** 現在当てている視覚順。先頭は必ず自分の列。 */
  visualOrder: () => number[]
  commit: (visualOrder: number[]) => void
  setDragging: (dragging: boolean) => void
}

type Active = {
  domIndex: number
  pointerId: number
  x: number
  y: number
  /** 自分の列と掴んでいる列を除いた並びの中での挿入位置。 */
  target: number
}

export type DragLayer = {
  refresh: () => void
  destroy: () => void
}

export function createDragLayer(host: DragHost): DragLayer {
  const layer = document.createElement('div')
  layer.id = 'gcalsorter-layer'
  const ghost = document.createElement('div')
  ghost.className = 'gcalsorter-ghost'
  const line = document.createElement('div')
  line.className = 'gcalsorter-insert'
  layer.append(ghost, line)
  document.body.append(layer)

  const grips = new Map<number, HTMLElement>()
  let active: Active | null = null
  let loop = 0
  let refreshFrame = 0

  function headerOf(detection: Detection, domIndex: number): HTMLElement | null {
    return detection.columns.find((c) => c.domIndex === domIndex)?.header ?? null
  }

  function aliasOf(detection: Detection, domIndex: number): string {
    return detection.columns.find((c) => c.domIndex === domIndex)?.alias ?? ''
  }

  /** 挿入線を伸ばす縦の範囲。ヘッダーの上端から、一番背の高いコンテナの下端まで。 */
  function verticalSpan(detection: Detection): { top: number; height: number } {
    const top = detection.headerRow.getBoundingClientRect().top
    let bottom = top
    for (const container of detection.containers) {
      const rect = container.el.getBoundingClientRect()
      if (rect.bottom > bottom) bottom = rect.bottom
    }
    return { top, height: Math.max(Math.min(bottom, window.innerHeight) - top, 0) }
  }

  function gripFor(domIndex: number): HTMLElement {
    const existing = grips.get(domIndex)
    if (existing) return existing
    const grip = document.createElement('div')
    grip.className = 'gcalsorter-grip'
    grip.textContent = '⠿'
    grip.title = 'ドラッグして列を並び替える'
    grip.addEventListener('pointerdown', (event) => onPointerDown(event, domIndex))
    layer.append(grip)
    grips.set(domIndex, grip)
    return grip
  }

  function layoutGrips(): void {
    const detection = host.detection()
    if (!detection) {
      for (const grip of grips.values()) grip.style.display = 'none'
      return
    }
    const movable = host.visualOrder().slice(1)
    for (const [domIndex, grip] of grips) {
      if (!movable.includes(domIndex)) grip.style.display = 'none'
    }
    const clip = detection.headerRow.getBoundingClientRect()
    for (const domIndex of movable) {
      const grip = gripFor(domIndex)
      const header = headerOf(detection, domIndex)
      const rect = header?.getBoundingClientRect()
      const onScreen =
        rect !== undefined &&
        rect.width > 0 &&
        rect.right > clip.left + 2 &&
        rect.left < clip.right - 2
      if (!onScreen || !rect) {
        grip.style.display = 'none'
        continue
      }
      grip.style.display = 'block'
      grip.style.left = `${Math.round(rect.left) + 3}px`
      grip.style.top = `${Math.round(rect.top) + 3}px`
      grip.classList.toggle('gcalsorter-grip-held', active?.domIndex === domIndex)
    }
  }

  function autoScroll(detection: Detection, x: number): void {
    if (detection.scrollers.length === 0) return
    const rect = detection.headerRow.getBoundingClientRect()
    const ramp = (distance: number): number =>
      Math.ceil((Math.min(distance, EDGE) / EDGE) * MAX_STEP)
    if (x < rect.left + EDGE) scrollColumnsBy(detection, -ramp(rect.left + EDGE - x))
    else if (x > rect.right - EDGE) scrollColumnsBy(detection, ramp(x - (rect.right - EDGE)))
  }

  function drawInsertLine(detection: Detection, others: number[], target: number): void {
    const clip = detection.headerRow.getBoundingClientRect()
    const span = verticalSpan(detection)
    const at = others[target]
    let x: number
    if (at !== undefined) {
      x = headerOf(detection, at)?.getBoundingClientRect().left ?? clip.left
    } else {
      const last = others.at(-1)
      const header = last === undefined ? null : headerOf(detection, last)
      x = header?.getBoundingClientRect().right ?? clip.right
    }
    line.style.left = `${Math.round(Math.min(Math.max(x, clip.left), clip.right)) - 1}px`
    line.style.top = `${Math.round(span.top)}px`
    line.style.height = `${Math.round(span.height)}px`
  }

  function tick(): void {
    const current = active
    const detection = host.detection()
    if (!current || !detection) {
      finish(false)
      return
    }
    autoScroll(detection, current.x)
    const movable = host.visualOrder().slice(1)
    const others = movable.filter((domIndex) => domIndex !== current.domIndex)
    let target = 0
    for (const domIndex of others) {
      const rect = headerOf(detection, domIndex)?.getBoundingClientRect()
      if (rect && rect.left + rect.width / 2 < current.x) target++
    }
    current.target = target
    drawInsertLine(detection, others, target)
    ghost.style.left = `${Math.round(current.x) + 14}px`
    ghost.style.top = `${Math.round(current.y) + 14}px`
    layoutGrips()
  }

  function startLoop(): void {
    if (loop) return
    const step = (): void => {
      if (!active) {
        loop = 0
        return
      }
      tick()
      loop = requestAnimationFrame(step)
    }
    loop = requestAnimationFrame(step)
  }

  function onPointerDown(event: PointerEvent, domIndex: number): void {
    const detection = host.detection()
    if (!detection || active) return
    // Google の列ヘッダーのクリック（その人の日表示へ移動）を奪わないよう、
    // グリップから始まった操作だけをここで飲み込む。
    event.preventDefault()
    event.stopPropagation()
    const grip = grips.get(domIndex)
    // カーソルがグリップから外れても座標を拾い続けたいので capture を試みるが、
    // 追跡自体は window のリスナーで行う。capture はあくまで補助。
    try {
      grip?.setPointerCapture(event.pointerId)
    } catch {
      // 掴めなくても window 側で追える。
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    active = { domIndex, pointerId: event.pointerId, x: event.clientX, y: event.clientY, target: 0 }
    ghost.textContent = aliasOf(detection, domIndex)
    const width = headerOf(detection, domIndex)?.getBoundingClientRect().width
    if (width !== undefined) ghost.style.width = `${Math.round(width)}px`
    ghost.style.display = 'block'
    line.style.display = 'block'
    host.setDragging(true)
    startLoop()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return
    active.x = event.clientX
    active.y = event.clientY
  }

  function onPointerUp(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return
    finish(true)
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return
    finish(false)
  }

  function finish(shouldCommit: boolean): void {
    const current = active
    active = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    if (loop) {
      cancelAnimationFrame(loop)
      loop = 0
    }
    ghost.style.display = 'none'
    line.style.display = 'none'
    host.setDragging(false)
    if (current) {
      const grip = grips.get(current.domIndex)
      if (grip?.hasPointerCapture(current.pointerId)) grip.releasePointerCapture(current.pointerId)
    }
    if (!shouldCommit || !current) {
      layoutGrips()
      return
    }
    const order = host.visualOrder()
    const self = order[0]
    const movable = order.slice(1)
    const from = movable.indexOf(current.domIndex)
    if (self === undefined || from < 0 || from === current.target) {
      layoutGrips()
      return
    }
    host.commit([self, ...moveItem(movable, from, current.target)])
  }

  function refresh(): void {
    if (refreshFrame) return
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0
      layoutGrips()
    })
  }

  const onViewportChange = (): void => refresh()
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !active) return
    event.stopPropagation()
    finish(false)
  }

  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('keydown', onKeyDown, true)

  return {
    refresh,
    destroy: () => {
      finish(false)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('keydown', onKeyDown, true)
      layer.remove()
      grips.clear()
    },
  }
}
