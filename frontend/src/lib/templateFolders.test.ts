import { describe, it, expect } from 'vitest'
import { groupByFolder, orderAfterGroupReorder, placeInFolder, removeFolder, type TemplateFolder } from './templateFolders'

const tpl = (id: string) => ({ id })
const key = (t: { id: string }) => `t:${t.id}`
const FOLDERS: TemplateFolder[] = [{ id: 'a', name: 'Contracte' }, { id: 'b', name: 'Declarații' }]

describe('groupByFolder', () => {
  it('întâi cele fără folder, apoi folderele în ordinea lor (și cele goale), păstrând ordinea primită', () => {
    const groups = groupByFolder([tpl('1'), tpl('2'), tpl('3')], key, FOLDERS, { 't:1': 'a', 't:3': 'a' })
    expect(groups.map(g => [g.folder?.name ?? null, g.items.map(t => t.id)])).toEqual([
      [null, ['2']], ['Contracte', ['1', '3']], ['Declarații', []],
    ])
  })

  it('fără foldere: o singură grupă, cu tot; un folder șters între timp nu ascunde șablonul', () => {
    expect(groupByFolder([tpl('1')], key, undefined, undefined)).toEqual([{ folder: null, items: [tpl('1')] }])
    expect(groupByFolder([tpl('1')], key, FOLDERS, { 't:1': 'sters' })[0].items).toEqual([tpl('1')])
  })
})

describe('mutări și ștergeri', () => {
  it('placeInFolder pune sau scoate un șablon dintr-un folder', () => {
    expect(placeInFolder({}, 't:1', 'a')).toEqual({ 't:1': 'a' })
    expect(placeInFolder({ 't:1': 'a' }, 't:1', null)).toEqual({})
  })

  it('removeFolder scoate folderul, iar șabloanele lui rămân, fără folder', () => {
    const r = removeFolder(FOLDERS, { 't:1': 'a', 't:2': 'b' }, 'a')
    expect(r.folders.map(f => f.id)).toEqual(['b'])
    expect(r.placement).toEqual({ 't:2': 'b' })
  })

  it('orderAfterGroupReorder schimbă doar ordinea grupei mutate', () => {
    const groups = groupByFolder([tpl('1'), tpl('2'), tpl('3'), tpl('4')], key, FOLDERS, { 't:3': 'a', 't:4': 'a' })
    expect(orderAfterGroupReorder(groups, key, FOLDERS[0], ['t:4', 't:3'])).toEqual(['t:1', 't:2', 't:4', 't:3'])
  })
})
