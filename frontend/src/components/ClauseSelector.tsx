import { useEffect, useState } from 'react'
import type { Client, ClauseMeta } from '../types'
import { CLAUSE_FIELD_SPECS, specMatchesClause, type ClientPatchProposal } from '../lib/clauseFieldSpecs'
import { parsePlaceholder } from '../lib/placeholders'
import CesiuneFields from './clauses/CesiuneFields'
import AdaugareCaenFields from './clauses/AdaugareCaenFields'
import SchimbareCaenPrincipalFields from './clauses/SchimbareCaenPrincipalFields'
import SchimbareAdministratorFields from './clauses/SchimbareAdministratorFields'
import InchiderePunctLucruFields from './clauses/InchiderePunctLucruFields'
import MajorareCapitalFields from './clauses/MajorareCapitalFields'

export interface ClauseSelectorValue {
  selectedClauses: string[]
  extraReplacements: Record<string, string>
  extraGroups: Record<string, Record<string, string>[]>
  clientPatches: Record<string, ClientPatchProposal>
  isComplete: boolean
}

interface Props {
  clauses: ClauseMeta[]
  client?: Partial<Client> | null
  baseReplacements: Record<string, string>
  onChange: (value: ClauseSelectorValue) => void
}

const EMPTY_ROWS: Record<string, string>[] = []

// Data curentă e completată automat (buildReplacements → baseReplacements) —
// nu are sens s-o mai arătăm ca un câmp de completat manual.
const AUTO_DATE_KEYS = new Set(['DATA_CURENTA', 'DATA_AZI', 'LUNA_AZI', 'AN_AZI'])

/** Clauze fără widget dedicat (sau al căror widget doar alege o valoare, ca
 * la închiderea unui punct de lucru) — patch-ul de client se calculează
 * direct din câmpurile plate, fără să treacă prin onClientPatch. */
function computeInlinePatch(
  tag: string, fields: Record<string, string>, client: Partial<Client> | null | undefined,
): ClientPatchProposal | null {
  if (tag === 'SCHIMBARE_SEDIU_SOCIAL' && fields.SEDIU_NOU) {
    return { label: `Sediul social nou: ${fields.SEDIU_NOU}`, patch: { sediuSocial: fields.SEDIU_NOU } }
  }
  if (tag === 'DESCHIDERE_PUNCT_DE_LUCRU' && fields.PUNCT_LUCRU_NOU_ADRESA) {
    return {
      label: `Adaugă punct de lucru: ${fields.PUNCT_LUCRU_NOU_ADRESA}`,
      patch: { puncteLucru: [...(client?.puncteLucru ?? []), fields.PUNCT_LUCRU_NOU_ADRESA] },
    }
  }
  if (tag === 'INCHIDERE_PUNCT_DE_LUCRU' && fields.PUNCT_LUCRU_INCHIS_ADRESA) {
    return {
      label: `Închide punct de lucru: ${fields.PUNCT_LUCRU_INCHIS_ADRESA}`,
      patch: { puncteLucru: (client?.puncteLucru ?? []).filter(p => p !== fields.PUNCT_LUCRU_INCHIS_ADRESA) },
    }
  }
  return null
}

export default function ClauseSelector({ clauses, client, baseReplacements, onChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fieldsByClause, setFieldsByClause] = useState<Record<string, Record<string, string>>>({})
  const [groupsByClause, setGroupsByClause] = useState<Record<string, Record<string, Record<string, string>[]>>>({})
  const [clientPatchByClause, setClientPatchByClause] = useState<Record<string, ClientPatchProposal | null>>({})

  const toggle = (tag: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(tag)) next.delete(tag); else next.add(tag)
    return next
  })

  const setField = (tag: string, key: string, value: string) =>
    setFieldsByClause(prev => ({ ...prev, [tag]: { ...prev[tag], [key]: value } }))

  const setGroup = (tag: string, groupName: string, rows: Record<string, string>[]) =>
    setGroupsByClause(prev => ({ ...prev, [tag]: { ...prev[tag], [groupName]: rows } }))

  const setClientPatch = (tag: string, proposal: ClientPatchProposal | null) =>
    setClientPatchByClause(prev => ({ ...prev, [tag]: proposal }))

  const isClauseComplete = (c: ClauseMeta): boolean => {
    const spec = CLAUSE_FIELD_SPECS[c.tag]
    const useWidget = !!spec && specMatchesClause(spec, c.placeholders)
    const groupFieldSet = new Set(useWidget && spec.groupFields ? spec.groupFields : [])
    const flatOk = c.placeholders.every(ph => {
      const key = ph.replace(/^\{\{|\}\}$/g, '')
      if (groupFieldSet.has(key)) return true // verificat separat, ca grup
      const v = fieldsByClause[c.tag]?.[key] ?? baseReplacements[ph]
      return !!v && v.trim() !== ''
    })
    const groupOk = useWidget && spec.groupName
      ? (groupsByClause[c.tag]?.[spec.groupName]?.length ?? 0) > 0
      : true
    return flatOk && groupOk
  }

  useEffect(() => {
    const extraReplacements: Record<string, string> = {}
    const extraGroups: Record<string, Record<string, string>[]> = {}
    const clientPatches: Record<string, ClientPatchProposal> = {}
    let complete = selected.size > 0
    for (const tag of selected) {
      const fields = fieldsByClause[tag] ?? {}
      for (const [k, v] of Object.entries(fields)) {
        if (v.trim() !== '') extraReplacements[`{{${k}}}`] = v
      }
      const groups = groupsByClause[tag] ?? {}
      for (const [groupName, rows] of Object.entries(groups)) {
        extraGroups[groupName] = rows
      }
      const patch = clientPatchByClause[tag] ?? computeInlinePatch(tag, fields, client)
      if (patch) clientPatches[tag] = patch
      const clause = clauses.find(c => c.tag === tag)
      if (clause && !isClauseComplete(clause)) complete = false
    }
    onChange({ selectedClauses: [...selected], extraReplacements, extraGroups, clientPatches, isComplete: complete })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fieldsByClause, groupsByClause, clientPatchByClause, clauses, client])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {clauses.map(c => {
        const isSelected = selected.has(c.tag)
        const spec = CLAUSE_FIELD_SPECS[c.tag]
        const useWidget = !!spec && specMatchesClause(spec, c.placeholders)

        return (
          <div key={c.tag} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', cursor: 'pointer',
              background: isSelected ? 'var(--p50)' : 'var(--s50)',
            }}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(c.tag)} />
              <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--s800)' }}>{c.label}</span>
              {isSelected && !isClauseComplete(c) && (
                <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--y700, #a16207)' }}>⚠️ incomplet</span>
              )}
            </label>

            {isSelected && (
              <div style={{ padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {useWidget && spec.widget === 'cesiune' && (
                  <CesiuneFields
                    client={client}
                    fields={fieldsByClause[c.tag] ?? {}}
                    onField={(k, v) => setField(c.tag, k, v)}
                    rows={groupsByClause[c.tag]?.[spec.groupName!] ?? EMPTY_ROWS}
                    onRows={rows => setGroup(c.tag, spec.groupName!, rows)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {useWidget && spec.widget === 'caenList' && (
                  <AdaugareCaenFields
                    client={client}
                    rows={groupsByClause[c.tag]?.[spec.groupName!] ?? EMPTY_ROWS}
                    onRows={rows => setGroup(c.tag, spec.groupName!, rows)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {useWidget && spec.widget === 'caenSingle' && (
                  <SchimbareCaenPrincipalFields
                    value={fieldsByClause[c.tag]?.CAEN_PRINCIPAL_NOU ?? ''}
                    onChange={v => setField(c.tag, 'CAEN_PRINCIPAL_NOU', v)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {useWidget && spec.widget === 'administrator' && (
                  <SchimbareAdministratorFields
                    client={client}
                    fields={fieldsByClause[c.tag] ?? {}}
                    onField={(k, v) => setField(c.tag, k, v)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {useWidget && spec.widget === 'punctLucruClose' && (
                  <InchiderePunctLucruFields
                    client={client}
                    value={fieldsByClause[c.tag]?.PUNCT_LUCRU_INCHIS_ADRESA ?? ''}
                    onChange={v => setField(c.tag, 'PUNCT_LUCRU_INCHIS_ADRESA', v)}
                  />
                )}
                {useWidget && spec.widget === 'majorareCapital' && (
                  <MajorareCapitalFields
                    client={client}
                    fields={fieldsByClause[c.tag] ?? {}}
                    onField={(k, v) => setField(c.tag, k, v)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {!useWidget && (() => {
                  const visible = c.placeholders.filter(ph => !AUTO_DATE_KEYS.has(ph.replace(/^\{\{|\}\}$/g, '')))
                  if (visible.length === 0) {
                    return <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Fără alte câmpuri de completat.</div>
                  }
                  return visible.map(ph => {
                    const key = ph.replace(/^\{\{|\}\}$/g, '')
                    const auto = baseReplacements[ph]
                    const { field: label } = parsePlaceholder(ph)
                    return (
                      <div key={ph}>
                        <label style={LABEL}>{label}</label>
                        <input
                          style={INPUT}
                          value={fieldsByClause[c.tag]?.[key] ?? auto ?? ''}
                          onChange={e => setField(c.tag, key, e.target.value)}
                        />
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const LABEL = {
  fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.04em',
  textTransform: 'uppercase' as const, display: 'block', marginBottom: '.25rem',
}
const INPUT = {
  padding: '.375rem .625rem', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--s300)',
  fontSize: '.85rem', color: 'var(--s800)', background: '#fff', width: '100%',
  fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' as const,
}
