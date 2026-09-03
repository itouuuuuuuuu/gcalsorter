import { detect, isAlive, reread, toSavedColumn, type Detection } from './columns'
import { applyOrder, rollback, verify, type RestoreEntry } from './apply'
import { mergeOrder, resolveOrder } from './order'
import { createDragLayer } from './drag'
import { defaultSettings, loadSettings, onStoredChange, saveDiagnostics, saveSettings } from './store'
import type { Diagnostics, SavedColumn, Settings } from './types'

/**
 * 日表示だけを対象にする。週表示や月表示にも列はあるが、そちらの列は日付なので
 * 並び替えたら別物になる。URL に `/r/day` を要求して安全側に倒す。
 */
const DAY_VIEW = /\/r\/day(\/|$)/

let settings: Settings = defaultSettings
let detection: Detection | null = null
let restore: RestoreEntry[] = []
let visualOrder: number[] = []
let dragging = false
let frame = 0
let lastReport = ''

const layer = createDragLayer({
  detection: () => detection,
  visualOrder: () => visualOrder,
  commit: (next) => commit(next),
  setDragging: (value) => {
    dragging = value
    if (!value) schedule()
  },
})

function report(state: Diagnostics['state'], detail: string): void {
  const key = `${state}:${detail}`
  if (key === lastReport) return
  lastReport = key
  void saveDiagnostics({ state, detail, at: Date.now() })
}

function stand(state: Diagnostics['state'], detail: string): void {
  detection = null
  visualOrder = []
  layer.refresh()
  report(state, detail)
}

function reapply(): void {
  if (dragging) return

  // 生きた検出結果があり、当てた順序もまだ効いているなら何もしない。
  // Google は現在時刻の線や予定チップを絶えず描き替えるので、ここで早く抜けないと
  // 変更のたびに全探索することになる。
  if (detection && isAlive(detection) && verify(detection, visualOrder)) {
    layer.refresh()
    return
  }

  // 直前の適用を戻し、Google 本来の並びを基準に測り直す。
  // ここで戻さないと、次の applyOrder が自分の値を復元用の基準として覚えてしまう。
  rollback(restore)
  restore = []

  if (!settings.enabled) {
    stand('idle', '拡張が無効になっています')
    return
  }
  if (!DAY_VIEW.test(location.pathname)) {
    stand('idle', '日表示ではありません')
    return
  }

  const found = detect()
  if (!found) {
    stand('unsupported', '列の構造を検出できませんでした')
    return
  }

  const self = found.columns.find((col) => col.isSelf)
  const movable = found.columns.filter((col) => !col.isSelf)
  if (!self || movable.length === 0) {
    stand('unsupported', '並び替えられる列がありません')
    return
  }

  const observed = movable.map((col) => toSavedColumn(col))
  const next = [
    self.domIndex,
    ...resolveOrder(settings.order, observed).flatMap((oi) => {
      const col = movable[oi]
      return col ? [col.domIndex] : []
    }),
  ]

  const entries = applyOrder(found, next)
  if (!verify(found, next)) {
    // 検出がどこかの層を取りこぼしている。中途半端に並んだ画面を見せるより、
    // Google 本来の表示に戻して黙って引き下がる。
    rollback(entries)
    stand('rolled-back', '並び替えを当てても列の位置が一致しませんでした')
    return
  }

  restore = entries
  detection = found
  visualOrder = next
  layer.refresh()
  report('applied', `${next.length} 列に適用しました`)
}

function commit(next: number[]): void {
  const found = detection
  if (!found) return
  // チップが後から描かれて id が判明していることがあるので、保存の直前に読み直す。
  reread(found)
  const byDom = new Map(found.columns.map((col) => [col.domIndex, col]))
  const visible: SavedColumn[] = []
  for (const domIndex of next) {
    const col = byDom.get(domIndex)
    if (!col || col.isSelf) continue
    visible.push(toSavedColumn(col))
  }
  settings = { ...settings, order: mergeOrder(settings.order, visible) }
  void saveSettings(settings)
  // 保存の往復を待たず、その場で当て直して手応えを返す。
  detection = null
  reapply()
}

function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    reapply()
  })
}

function start(): void {
  const observer = new MutationObserver(() => schedule())
  observer.observe(document.body, { childList: true, subtree: true })
  // SPA なので、日表示から出た/入ったことは URL の変化でしか分からない。
  window.addEventListener('popstate', () => schedule())
  window.addEventListener('hashchange', () => schedule())
  schedule()
}

onStoredChange((change) => {
  if (!change.settings) return
  settings = change.settings
  // 順序が変わったら作り直す必要があるので、キャッシュを捨てる。
  detection = null
  schedule()
})

void loadSettings().then((loaded) => {
  settings = loaded
  start()
})
