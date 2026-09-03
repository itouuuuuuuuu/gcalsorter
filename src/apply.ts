import type { ContainerRef, Detection } from './columns'

/**
 * 並び替えは CSS の `order` だけで行う。DOM ノードは動かさない。
 *
 * 実測で、日表示の列コンテナはすべて `display: flex` で子が `position: static`
 * だったため `order` が効く。ノードを動かさないので、Google 側の再描画と
 * 取り合いになりにくい。
 */

export type RestoreEntry = { el: HTMLElement; order: string; borderRight: string }

/**
 * 右罫線の付け替えに関わる 3 者。`applyOrder` と `bordersConsistent` はこれを共有する。
 *
 * 判定を 2 か所に写すと、片方だけ直したときに「適用側は触らないのに検証側は拒む」
 * 状態になり、rollback → 検出 → 適用 → 拒否のループに落ちる。
 */
type BorderPatch = {
  /** DOM 末尾の列。右端以外に置かれたので、普通の罫線を持たせたい。 */
  moved: HTMLElement
  /** 右端に置いた列。罫線を消したい。 */
  edge: HTMLElement
  /** 触っていない列から読んだ、途中の列の右罫線。 */
  normal: string
}

/**
 * 付け替えの対象を求める。何も付け替えないコンテナなら null。
 *
 * - 列が 3 本未満、あるいは DOM 末尾の列がそのまま右端なら、付け替え自体が起きない。
 * - 途中の列が右罫線を描いていない（幅 0 か `none`）コンテナも対象外。そこでは Google の
 *   末尾装飾も見えないし、`0px none <currentColor>` の色成分だけを比べて揺れるのを避ける。
 *
 * 途中の列の値は、DOM 末尾でも右端でもない最初の列から読む。Google が装飾するのは
 * 末尾の 1 本だけなので（実測）、残りはすべて同じ値になる。
 */
function borderPatch(container: ContainerRef, rightEdge: number): BorderPatch | null {
  const children = container.columnChildren
  let domLast = -1
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i]) {
      domLast = i
      break
    }
  }
  if (domLast < 0 || domLast === rightEdge) return null
  const moved = children[domLast]
  const edge = children[rightEdge]
  const reference = children.find((c, i) => c !== null && i !== domLast && i !== rightEdge)
  if (!moved || !edge || !reference) return null
  const style = getComputedStyle(reference)
  if (style.borderRightStyle === 'none' || parseFloat(style.borderRightWidth) === 0) return null
  return { moved, edge, normal: style.borderRight }
}

/**
 * 視覚順を当てる。`visualToDom[v]` は、左から v 番目に置きたい列の DOM 順インデックス。
 *
 * 列でない子要素（実測では 9px と 16px のスペーサー）にも order を明示する。
 * 放っておくと既定値 0 のまま列より前に回り込み、末尾のスペーサーが左端へ飛ぶ。
 *
 * 右の罫線は要素ではなく「位置」に属するので、一緒に付け替える。Google は DOM 末尾の列に
 * だけ罫線を消す装飾を当てており、実測では時間グリッド本体 (`.BiKU4b.Qbfsob`) が
 * `border-right: 0.909px solid rgb(255,255,255)`（背景色で塗り潰して消す）、
 * 終日リストの末尾が `border-right: 0px none`。その列を右端以外へ動かすと、画面の途中で
 * 縦罫線が 1 本消える。
 *
 * 動かすのは 1 コンテナにつき 2 本だけ。消す側は色を `transparent` にする。Google のように
 * 背景色を解決した値を書くと、テーマが切り替わったときにその 1 本だけ古い色で取り残される。
 * `transparent` なら背後の面がそのまま見えるので、どのテーマでも同じ結果になる。
 * 罫線を戻す側は解決済みの色を書かざるを得ないので、そちらは `verify` が見張る。
 */
export function applyOrder(detection: Detection, visualToDom: readonly number[]): RestoreEntry[] {
  const count = visualToDom.length
  const orderOfDom = new Map<number, number>()
  visualToDom.forEach((domIndex, visual) => orderOfDom.set(domIndex, visual + 1))
  const rightEdge = visualToDom[count - 1] ?? -1

  const restore: RestoreEntry[] = []
  for (const container of detection.containers) {
    container.columnChildren.forEach((el, domIndex) => {
      if (!el) return
      const order = orderOfDom.get(domIndex)
      if (order === undefined) return
      restore.push({ el, order: el.style.order, borderRight: el.style.borderRight })
      el.style.order = String(order)
    })
    for (const spacer of container.spacers) {
      restore.push({ el: spacer.el, order: spacer.el.style.order, borderRight: spacer.el.style.borderRight })
      spacer.el.style.order = spacer.before ? '0' : String(count + 1)
    }

    const patch = borderPatch(container, rightEdge)
    if (!patch) continue
    // このコンテナが末尾の列を特別扱いしていないなら、付け替えるものは何も無い。
    if (getComputedStyle(patch.moved).borderRight === patch.normal) continue
    patch.moved.style.borderRight = patch.normal
    patch.edge.style.borderRightColor = 'transparent'
  }
  return restore
}

export function rollback(restore: readonly RestoreEntry[]): void {
  for (const entry of restore) {
    entry.el.style.order = entry.order
    entry.el.style.borderRight = entry.borderRight
  }
}

/**
 * 罫線を戻した列が、今の Google の見た目とまだ噛み合っているかを見る。
 *
 * `applyOrder` が書き込む解決済みの色はこの 1 本だけで、テーマ（ライト/ダーク）が
 * 切り替わると、その列だけ古い色で取り残される。テーマの切り替えは `content.ts` 側で
 * 拾って測り直すが、拾えない経路が残ったときの受け皿としてここでも突き合わせる。
 *
 * 突き合わせる不変条件は「右端に置いた列以外はすべて同じ右罫線を持つ」。触っていない列を
 * 1 本読めば足りる。消す側は `transparent` なのでテーマに依存せず、見張る必要がない。
 */
function bordersConsistent(container: ContainerRef, rightEdge: number): boolean {
  const patch = borderPatch(container, rightEdge)
  if (!patch) return true
  return getComputedStyle(patch.moved).borderRight === patch.normal
}

/**
 * 当てた `order` が実際に効いたかを、rect を測り直して確かめる。
 *
 * 検出が 1 コンテナ取りこぼしていても、取りこぼした層はエラーを出さずに
 * 元の順序で残るだけなので、適用側からは気付けない。ここで各コンテナの
 * 実際の左右の並びを読み、意図した順序と一致しないものがあれば失敗を返す。
 *
 * 罫線の食い違いも同じ扱いにする。false を返せば `reapply` が rollback してから
 * 測り直すので、テーマが変わっても次のティックで正しい色に貼り直される。
 */
export function verify(detection: Detection, visualToDom: readonly number[]): boolean {
  const rightEdge = visualToDom[visualToDom.length - 1] ?? -1
  for (const container of detection.containers) {
    if (!bordersConsistent(container, rightEdge)) return false
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
