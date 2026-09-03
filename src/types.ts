/**
 * 保存する列の識別情報。
 *
 * `id` は列ヘッダー内に見つかった `data-calendarid`。この属性は列そのものではなく
 * 勤務場所チップや終日予定チップに付いているため、予定も勤務場所もない列では
 * 取得できない。取得できなかった場合は null になり、`alias`（表示名）で照合する。
 */
export type SavedColumn = {
  id: string | null
  alias: string
}

export type Settings = {
  enabled: boolean
  /** 自分の列を除いた、左から右への並び順。非表示のメンバーも残る。 */
  order: SavedColumn[]
}

/** ポップアップに出す、最新の適用状況。 */
export type Diagnostics = {
  state: 'applied' | 'idle' | 'unsupported' | 'rolled-back'
  detail?: string
  at: number
}
