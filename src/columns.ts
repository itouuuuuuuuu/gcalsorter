import type { SavedColumn } from './types'

/**
 * 列ヘッダーの位置と幅だけを頼りに、日表示の「列」を構成する DOM を見つける。
 *
 * Google カレンダーの class 名は難読化されていてデプロイごとに変わるため、一切使わない。
 * 列幅もウィンドウ幅やメンバー数で変わるので、閾値も持たない。毎回ヘッダーの実測 rect を
 * アンカーにして、そこに幾何的に一致する子要素を持つコンテナを探す。
 *
 * 日表示の列は 1 つのコンテナに収まっておらず、実測では 5 つの flex コンテナ
 * （背景罫線・ヘッダー行・終日行・終日リストの ul・時間グリッド本体）に分散していた。
 * どれか 1 つでも取りこぼすと、その層だけ並び替わらない。
 */

/** アンカーとの一致を許す誤差 (px)。サブピクセルの丸めを吸収する。 */
const TOLERANCE = 2

/** ヘッダー行から探索ルートまで遡る段数。実測では 8 段で全コンテナが入った。 */
const ROOT_CLIMB = 10

export type ColumnRef = {
  /** 列ヘッダーの DOM 順のインデックス。0 は必ず自分の列。 */
  domIndex: number
  header: HTMLElement
  id: string | null
  alias: string
  isSelf: boolean
}

export type ContainerRef = {
  el: HTMLElement
  /** DOM 順の列インデックス -> その列に対応する子要素。 */
  columnChildren: (HTMLElement | null)[]
  /** 列ではない子要素。`before` は最初の列より DOM 上で前にあるか。 */
  spacers: { el: HTMLElement; before: boolean }[]
}

export type Detection = {
  root: HTMLElement
  headerRow: HTMLElement
  columns: ColumnRef[]
  containers: ContainerRef[]
  /**
   * 列を横スクロールさせるコンテナ。実測では 3 つあり、Google が JS で同期させている。
   * 空の場合は列が画面に収まっていて横スクロールしない。
   */
  scrollers: HTMLElement[]
}

export function toSavedColumn(col: ColumnRef): SavedColumn {
  return { id: col.id, alias: col.alias }
}

/**
 * 表示名を読む。
 *
 * 実測では、ヘッダー内で `data-eventchip`（勤務場所チップなど）の外にある
 * `aria-label` のうち最後のものが表示名だった。自分の列だけ日付の aria-label が
 * 前に並ぶため、先頭ではなく最後を取る。
 */
function readAlias(header: HTMLElement): string {
  const labelled = [...header.querySelectorAll<HTMLElement>('[aria-label]')].filter(
    (el) => !el.closest('[data-eventchip]'),
  )
  const label = labelled.at(-1)?.getAttribute('aria-label')?.trim()
  if (label) return label
  const lines = header.innerText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return lines[0] ?? ''
}

function readColumn(header: HTMLElement, domIndex: number): ColumnRef {
  const id = header.querySelector('[data-calendarid]')?.getAttribute('data-calendarid') ?? null
  return { domIndex, header, id, alias: readAlias(header), isSelf: domIndex === 0 }
}

/** ヘッダーを最も多く抱えている親要素をヘッダー行とみなす。 */
function findHeaderRow(headers: HTMLElement[]): { row: HTMLElement; cells: HTMLElement[] } | null {
  const groups = new Map<HTMLElement, HTMLElement[]>()
  for (const h of headers) {
    const parent = h.parentElement
    if (!parent) continue
    const list = groups.get(parent)
    if (list) list.push(h)
    else groups.set(parent, [h])
  }
  let row: HTMLElement | null = null
  let cells: HTMLElement[] = []
  for (const [parent, list] of groups) {
    if (list.length > cells.length) {
      row = parent
      cells = list
    }
  }
  if (!row || cells.length < 2) return null
  return { row, cells }
}

function climbToRoot(from: HTMLElement): HTMLElement {
  let root = from
  for (let i = 0; i < ROOT_CLIMB; i++) {
    const parent = root.parentElement
    if (!parent || root === document.body) break
    root = parent
  }
  return root
}

/**
 * 横スクロールするコンテナを、列コンテナごとに遡って集める。
 *
 * 実測では、ヘッダー行・終日行・時間グリッド本体がそれぞれ別の横スクロールコンテナに
 * 入っており、Google が JS で 3 つを同期させていた。ヘッダー行自身もスクロールコンテナ
 * なので、ヘッダーから遡ると即座にそれが見つかってしまうが、そこに `scrollLeft` を
 * 代入してもヘッダーだけが動いて本体が取り残される（実測：ヘッダー -120px、本体 0px）。
 * プログラムからの代入では Google の同期が走らないため、全部を自分で動かす必要がある。
 */
function collectScrollers(containers: ContainerRef[], root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const container of containers) {
    let el: HTMLElement | null = container.el
    while (el) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const overflowX = getComputedStyle(el).overflowX
        if (overflowX === 'auto' || overflowX === 'scroll') {
          if (!found.includes(el)) found.push(el)
          break
        }
      }
      if (el === root) break
      el = el.parentElement
    }
  }
  return found
}

/**
 * 列の横スクロールを、すべてのスクロールコンテナで揃えて動かす。
 *
 * 上限は `scrollWidth - clientWidth` では正しく求まらない。この値は整数に丸められて
 * いるのに実際の上限は小数（実測 165.45）で、上限を超える値を渡すとブラウザが
 * コンテナごとの真の上限で個別にクランプし、値がばらける。一度書き込んでから
 * 実際に落ち着いた値を読み戻し、その最小値で全部を揃え直す。
 */
export function scrollColumnsBy(detection: Detection, delta: number): void {
  const primary = detection.scrollers[0]
  if (!primary) return
  const target = Math.max(primary.scrollLeft + delta, 0)
  for (const scroller of detection.scrollers) scroller.scrollLeft = target
  let settled = Number.POSITIVE_INFINITY
  for (const scroller of detection.scrollers) settled = Math.min(settled, scroller.scrollLeft)
  for (const scroller of detection.scrollers) scroller.scrollLeft = settled
}

type Anchor = { x: number; width: number }

function matchContainers(root: HTMLElement, anchors: Anchor[]): ContainerRef[] {
  const found: ContainerRef[] = []
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const kids = [...el.children] as HTMLElement[]
    if (kids.length < anchors.length) continue

    const columnChildren: (HTMLElement | null)[] = new Array(anchors.length).fill(null)
    let matched = 0
    for (const kid of kids) {
      const rect = kid.getBoundingClientRect()
      if (rect.width <= 0) continue
      for (let i = 0; i < anchors.length; i++) {
        if (columnChildren[i]) continue
        const anchor = anchors[i]
        if (!anchor) continue
        if (
          Math.abs(rect.x - anchor.x) < TOLERANCE &&
          Math.abs(rect.width - anchor.width) < TOLERANCE
        ) {
          columnChildren[i] = kid
          matched++
          break
        }
      }
      if (matched === anchors.length) break
    }
    if (matched !== anchors.length) continue

    const columns = new Set(columnChildren.filter((c): c is HTMLElement => c !== null))
    const firstColumnAt = kids.findIndex((k) => columns.has(k))
    const spacers = kids
      .map((k, i) => ({ el: k, before: i < firstColumnAt }))
      .filter((s) => !columns.has(s.el))
    found.push({ el, columnChildren, spacers })
  }
  return found
}

/**
 * 日表示の列構造を検出する。見つからなければ null。
 *
 * 列が 2 本未満のときは null を返す。並び替える対象が無いだけでなく、
 * アンカーが 1 本だと「同じ x と幅を持つ要素」がページ中に大量に一致してしまい、
 * 幾何照合が誤検出するため。
 */
export function detect(): Detection | null {
  const headers = [...document.querySelectorAll<HTMLElement>('[role="columnheader"]')]
  if (headers.length < 2) return null

  const header = findHeaderRow(headers)
  if (!header) return null

  const anchors: Anchor[] = header.cells.map((cell) => {
    const rect = cell.getBoundingClientRect()
    return { x: rect.x, width: rect.width }
  })
  if (anchors.some((a) => a.width <= 0)) return null

  const root = climbToRoot(header.row)
  const containers = matchContainers(root, anchors)
  // ヘッダー行自身が見つからないなら、アンカーの測り方が破綻している。
  if (!containers.some((c) => c.el === header.row)) return null

  return {
    root,
    headerRow: header.row,
    columns: header.cells.map((cell, i) => readColumn(cell, i)),
    containers,
    scrollers: collectScrollers(containers, root),
  }
}

/** 検出結果がまだ DOM に生きているかの安価な確認。 */
export function isAlive(detection: Detection): boolean {
  if (!detection.headerRow.isConnected) return false
  for (const container of detection.containers) {
    if (!container.el.isConnected) return false
    for (const child of container.columnChildren) {
      if (child && !child.isConnected) return false
    }
  }
  return detection.columns.every((c) => c.header.isConnected)
}

/**
 * 生きているヘッダーから id と表示名を読み直す。
 *
 * 勤務場所チップは列の描画より後から差し込まれることがあり、初回検出の時点では
 * `data-calendarid` を取れないことがある。並び替えを保存する直前に読み直して、
 * その時点で取れる最良の識別子を残す。
 */
export function reread(detection: Detection): void {
  detection.columns = detection.columns.map((col) => readColumn(col.header, col.domIndex))
}

/**
 * 日表示かどうかを DOM から判定する。
 *
 * URL は当てにならない。Chrome の「アプリとしてインストール」で作った PWA は
 * `https://calendar.google.com/calendar/r` を開いたまま既定のビューを描くため、
 * 日表示でもパスに `/r/day` が現れない（実測: `/calendar/u/0/r`）。
 *
 * 代わりに `data-datekey` の種類数を数える。実測値:
 *
 * | ビュー            | data-datekey の種類 | columnheader |
 * | ----------------- | ------------------- | ------------ |
 * | 日 (メンバー 9 人) | 1                  | 9            |
 * | 週 (5 日)          | 5                  | 5            |
 * | 月                 | 25                 | 5 (曜日名)   |
 *
 * 月表示は列ヘッダー自体に datekey を持たないので「ヘッダーに datekey が無いこと」では
 * 弾けない。文書全体の種類数が「ちょうど 1」であることを要求する。この形なら Google が
 * この属性をやめたときは 0 になって黙って引き下がる。週表示の日付列を並び替えてしまう
 * 側には倒れない。左のミニカレンダーを開いても種類が増えないことは実測で確認している。
 */
export function isDayView(): boolean {
  const keys = new Set<string>()
  for (const el of document.querySelectorAll('[data-datekey]')) {
    const key = el.getAttribute('data-datekey')
    if (key) keys.add(key)
    if (keys.size > 1) return false
  }
  return keys.size === 1
}
