import { describe, expect, it } from 'vitest'
import { findMatch, mergeOrder, moveItem, resolveOrder } from './order'
import type { SavedColumn } from './types'

const col = (alias: string, id: string | null = null): SavedColumn => ({ id, alias })

/** 表示順に並べ替えた結果を、読みやすい表示名の配列にして返す。 */
const applied = (saved: SavedColumn[], observed: SavedColumn[]): string[] =>
  resolveOrder(saved, observed).map((oi) => observed[oi]!.alias)

describe('resolveOrder', () => {
  it('保存済みの順に並べる', () => {
    const saved = [col('佐藤'), col('鈴木'), col('田中')]
    const observed = [col('田中'), col('佐藤'), col('鈴木')]
    expect(applied(saved, observed)).toEqual(['佐藤', '鈴木', '田中'])
  })

  it('保存済みに無い列は元の相対順で末尾に付く', () => {
    const saved = [col('佐藤'), col('鈴木')]
    const observed = [col('山田'), col('鈴木'), col('渡辺'), col('佐藤')]
    expect(applied(saved, observed)).toEqual(['佐藤', '鈴木', '山田', '渡辺'])
  })

  it('保存が空なら観測順のまま', () => {
    const observed = [col('佐藤'), col('鈴木')]
    expect(applied([], observed)).toEqual(['佐藤', '鈴木'])
  })

  it('非表示のメンバーは飛ばして詰める', () => {
    const saved = [col('佐藤'), col('鈴木'), col('田中')]
    const observed = [col('田中'), col('佐藤')]
    expect(applied(saved, observed)).toEqual(['佐藤', '田中'])
  })

  it('表示名が変わっても id が一致すれば順位を保つ', () => {
    const saved = [col('佐藤', 'id-sato'), col('鈴木', 'id-suzuki')]
    const observed = [col('鈴木', 'id-suzuki'), col('佐藤 直哉', 'id-sato')]
    expect(applied(saved, observed)).toEqual(['佐藤 直哉', '鈴木'])
  })

  it('id が取れない日でも表示名で順位を引き継ぐ', () => {
    const saved = [col('佐藤', 'id-sato'), col('鈴木', 'id-suzuki')]
    const observed = [col('鈴木', null), col('佐藤', null)]
    expect(applied(saved, observed)).toEqual(['佐藤', '鈴木'])
  })

  it('同名でも id が食い違えば別人として扱う', () => {
    const saved = [col('佐藤', 'id-a'), col('鈴木', 'id-suzuki')]
    const observed = [col('鈴木', 'id-suzuki'), col('佐藤', 'id-b')]
    // 佐藤(id-b) は保存済みの佐藤(id-a) とは別人なので、末尾に回る
    expect(applied(saved, observed)).toEqual(['鈴木', '佐藤'])
  })
})

describe('mergeOrder', () => {
  it('非表示のメンバーを保存順に残す', () => {
    const saved = [col('佐藤'), col('鈴木'), col('田中')]
    // 鈴木を非表示にした状態で、佐藤と田中を入れ替えて確定
    const visible = [col('田中'), col('佐藤')]
    expect(mergeOrder(saved, visible).map((c) => c.alias)).toEqual(['田中', '佐藤', '鈴木'])
  })

  it('先頭にいた非表示メンバーは先頭に残る', () => {
    const saved = [col('佐藤'), col('鈴木'), col('田中')]
    const visible = [col('田中'), col('鈴木')]
    expect(mergeOrder(saved, visible).map((c) => c.alias)).toEqual(['佐藤', '田中', '鈴木'])
  })

  it('新しいメンバーを保存順に取り込む', () => {
    const saved = [col('佐藤'), col('鈴木')]
    const visible = [col('鈴木'), col('山田'), col('佐藤')]
    expect(mergeOrder(saved, visible).map((c) => c.alias)).toEqual(['鈴木', '山田', '佐藤'])
  })

  it('非表示にして再表示すると元の位置に戻る', () => {
    // 佐藤 → 鈴木 → 田中 の順で保存されている
    const saved = [col('佐藤', 'a'), col('鈴木', 'b'), col('田中', 'c')]
    // 鈴木を非表示にし、その状態で並び替えずに確定する
    const whileHidden = mergeOrder(saved, [col('佐藤', 'a'), col('田中', 'c')])
    expect(whileHidden.map((c) => c.alias)).toEqual(['佐藤', '鈴木', '田中'])
    // 鈴木を再表示すると、元の 2 番目に戻る
    const observed = [col('田中', 'c'), col('鈴木', 'b'), col('佐藤', 'a')]
    expect(applied(whileHidden, observed)).toEqual(['佐藤', '鈴木', '田中'])
  })

  it('id を取れない日に並び替えても id を失わない', () => {
    const saved = [col('佐藤', 'a'), col('鈴木', 'b')]
    // その日は勤務場所も予定も無く、id が取れなかった
    const visible = [col('鈴木', null), col('佐藤', null)]
    const merged = mergeOrder(saved, visible)
    expect(merged.map((c) => c.alias)).toEqual(['鈴木', '佐藤'])
    // 呼び出し側が観測値をそのまま保存するため id は null になるが、
    // 表示名で照合できるので翌日 id が戻れば順位は維持される
    const observed = [col('佐藤', 'a'), col('鈴木', 'b')]
    expect(applied(merged, observed)).toEqual(['鈴木', '佐藤'])
  })
})

describe('moveItem', () => {
  it('右へ動かす', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('左へ動かす', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('同じ位置なら変わらない', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })
})
