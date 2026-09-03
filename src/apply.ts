import type { Detection } from './columns'

/**
 * 並び替えは CSS の `order` だけで行う。DOM ノードは動かさない。
 *
 * 実測で、日表示の列コンテナはすべて `display: flex` で子が `position: static`
 * だったため `order` が効く。ノードを動かさないので、Google 側の再描画と
 * 取り合いになりにくい。
 */

export type RestoreEntry = { el: HTMLElement; order: string }

/**
 * 視覚順を当てる。`visualToDom[v]` は、左から v 番目に置きたい列の DOM 順インデックス。
 *
 * 列でない子要素（実測では 9px と 16px のスペーサー）にも order を明示する。
 * 放っておくと既定値 0 のまま列より前に回り込み、末尾のスペーサーが左端へ飛ぶ。
 */
export function applyOrder(detection: Detection, visualToDom: readonly number[]): RestoreEntry[] {
  const count = visualToDom.length
  const orderOfDom = new Map<number, number>()
  visualToDom.forEach((domIndex, visual) => orderOfDom.set(domIndex, visual + 1))

  const restore: RestoreEntry[] = []
  for (const container of detection.containers) {
    container.columnChildren.forEach((el, domIndex) => {
      if (!el) return
      const order = orderOfDom.get(domIndex)
      if (order === undefined) return
      restore.push({ el, order: el.style.order })
      el.style.order = String(order)
    })
    for (const spacer of container.spacers) {
      restore.push({ el: spacer.el, order: spacer.el.style.order })
      spacer.el.style.order = spacer.before ? '0' : String(count + 1)
    }
  }
  return restore
}

export function rollback(restore: readonly RestoreEntry[]): void {
  for (const entry of restore) entry.el.style.order = entry.order
}

/**
 * 当てた `order` が実際に効いたかを、rect を測り直して確かめる。
 *
 * 検出が 1 コンテナ取りこぼしていても、取りこぼした層はエラーを出さずに
 * 元の順序で残るだけなので、適用側からは気付けない。ここで各コンテナの
 * 実際の左右の並びを読み、意図した順序と一致しないものがあれば失敗を返す。
 */
export function verify(detection: Detection, visualToDom: readonly number[]): boolean {
  for (const container of detection.containers) {
    const placed: { domIndex: number; x: number }[] = []
    container.columnChildren.forEach((el, domIndex) => {
      if (!el) return
      placed.push({ domIndex, x: el.getBoundingClientRect().x })
    })
    if (placed.length !== visualToDom.length) return false
    placed.sort((a, b) => a.x - b.x)
    for (let i = 0; i < placed.length; i++) {
      if (placed[i]?.domIndex !== visualToDom[i]) return false
    }
  }
  return true
}
