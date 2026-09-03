import type { SavedColumn } from './types'

/**
 * 保存済みリストから `col` に対応する要素を探す。照合は
 * 「data-calendarid 一致 → 表示名一致」の順。
 *
 * 表示名で拾うときは、双方の id が判明していて食い違う場合を除外する。
 * 同姓同名の別人が、片方だけ id を取れた日に取り違えられるのを防ぐため。
 *
 * `taken` のインデックスは既に他の列が取ったものとして飛ばす。
 */
export function findMatch(
  saved: readonly SavedColumn[],
  col: SavedColumn,
  taken: ReadonlySet<number>,
): number {
  if (col.id !== null) {
    for (let i = 0; i < saved.length; i++) {
      if (taken.has(i)) continue
      const s = saved[i]
      if (s && s.id !== null && s.id === col.id) return i
    }
  }
  for (let i = 0; i < saved.length; i++) {
    if (taken.has(i)) continue
    const s = saved[i]
    if (!s || s.alias !== col.alias) continue
    const idsConflict = s.id !== null && col.id !== null && s.id !== col.id
    if (!idsConflict) return i
  }
  return -1
}

/**
 * 観測した列を保存済みの順序に並べ、`observed` のインデックスを表示順
 * （左から右）で返す。保存済みに無い列は元の相対順を保ったまま末尾に付く。
 */
export function resolveOrder(
  saved: readonly SavedColumn[],
  observed: readonly SavedColumn[],
): number[] {
  const taken = new Set<number>()
  const observedOfSaved = new Map<number, number>()
  const matched = new Set<number>()

  observed.forEach((col, oi) => {
    const si = findMatch(saved, col, taken)
    if (si < 0) return
    taken.add(si)
    observedOfSaved.set(si, oi)
    matched.add(oi)
  })

  const out: number[] = []
  for (let si = 0; si < saved.length; si++) {
    const oi = observedOfSaved.get(si)
    if (oi !== undefined) out.push(oi)
  }
  observed.forEach((_, oi) => {
    if (!matched.has(oi)) out.push(oi)
  })
  return out
}

/**
 * 並び替えの確定時に、新しい保存順を作る。
 *
 * `visible` は今画面に出ている列の新しい並び。保存済みにしか無い列（カレンダーの
 * チェックを外して非表示にしたメンバー）は捨てず、「保存順で直前にいた表示中の列」を
 * アンカーとしてその直後に戻す。こうすると再表示したときに元の位置へ復帰する。
 */
export function mergeOrder(
  saved: readonly SavedColumn[],
  visible: readonly SavedColumn[],
): SavedColumn[] {
  const taken = new Set<number>()
  const savedIndexOfVisible = visible.map((col) => {
    const si = findMatch(saved, col, taken)
    if (si >= 0) taken.add(si)
    return si
  })

  const hidden: { col: SavedColumn; anchor: number | null }[] = []
  let anchor: number | null = null
  for (let si = 0; si < saved.length; si++) {
    const s = saved[si]
    if (!s) continue
    if (taken.has(si)) {
      anchor = si
      continue
    }
    hidden.push({ col: s, anchor })
  }

  const out: SavedColumn[] = []
  for (const h of hidden) {
    if (h.anchor === null) out.push(h.col)
  }
  visible.forEach((col, vi) => {
    out.push(col)
    const si = savedIndexOfVisible[vi]
    if (si === undefined || si < 0) return
    for (const h of hidden) {
      if (h.anchor === si) out.push(h.col)
    }
  })
  return out
}

/** 配列の要素を `from` から `to` へ動かした新しい配列を返す。 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  const [picked] = out.splice(from, 1)
  if (picked === undefined) return [...items]
  out.splice(to, 0, picked)
  return out
}
