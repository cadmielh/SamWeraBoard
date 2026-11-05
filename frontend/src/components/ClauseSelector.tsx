import { useEffect, useState } from 'react'
import type { Client, ClauseMeta } from '../types'
import { findClauseSpec, type ClientPatchProposal } from '../lib/clauseFieldSpecs'
import { parsePlaceholder, isDateLabel, caenFieldKind } from '../lib/placeholders'
import { parseAdresa } from '../lib/adresa'
import DateFieldInput from './DateFieldInput'
import CesiuneFields from './clauses/CesiuneFields'
import AdaugareCaenFields from './clauses/AdaugareCaenFields'
import SchimbareCaenPrincipalFields from './clauses/SchimbareCaenPrincipalFields'
import SchimbareAdministratorFields from './clauses/SchimbareAdministratorFields'
import InchiderePunctLucruFields from './clauses/InchiderePunctLucruFields'
import DeschiderePunctLucruFields from './clauses/DeschiderePunctLucruFields'
import MajorareCapitalFields from './clauses/MajorareCapitalFields'
import MajorareCapitalMultiFields from './clauses/MajorareCapitalMultiFields'
import ModificareIdentitateAsociatFields from './clauses/ModificareIdentitateAsociatFields'
import ActualizarePersoaneFields from './clauses/ActualizarePersoaneFields'
import DurataFields from './clauses/DurataFields'
import CaenFieldInput from './clauses/CaenFieldInput'
import { findCaenDescriere } from '../data/caen'

export interface ClauseSelectorValue {
  selectedClauses: string[]
  extraReplacements: Record<string, string>
  extraGroups: Record<string, Record<string, string>[]>
  clientPatches: Record<string, ClientPatchProposal>
  isComplete: boolean
  /** Câmpurile obligatorii ale clauzelor bifate (baza procentului afișat lângă șablon). `missing` conține etichete de câmp
   * ({{CAMP}}) sau, pentru listele repetitive, un text „listă: …”. */
  completion: { done: number; total: number; missing: string[] }
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
 * direct din câmpurile plate, fără să treacă prin onClientPatch. Se decide
 * după câmpuri, nu după numele clauzei, ca să meargă și în șabloanele altor clienți. */
function computeInlinePatch(
  fields: Record<string, string>, client: Partial<Client> | null | undefined,
): ClientPatchProposal | null {
  if (fields.SEDIU_NOU) {
    return { label: `Sediul social nou: ${fields.SEDIU_NOU}`, patch: { sediuSocial: parseAdresa(fields.SEDIU_NOU) } }
  }
  // Un punct ales din cele deja trecute în fișă nu se mai adaugă o dată — doar unul introdus manual
  if (fields.PUNCT_LUCRU_NOU_ADRESA && !client?.puncteLucru?.includes(fields.PUNCT_LUCRU_NOU_ADRESA)) {
    return {
      label: `Adaugă punct de lucru: ${fields.PUNCT_LUCRU_NOU_ADRESA}`,
      patch: { puncteLucru: [...(client?.puncteLucru ?? []), fields.PUNCT_LUCRU_NOU_ADRESA] },
    }
  }
  if (fields.PUNCT_LUCRU_INCHIS_ADRESA) {
    return {
      label: `Închide punct de lucru: ${fields.PUNCT_LUCRU_INCHIS_ADRESA}`,
      patch: { puncteLucru: (client?.puncteLucru ?? []).filter(p => p !== fields.PUNCT_LUCRU_INCHIS_ADRESA) },
    }
  }
  // CAEN principal ales din listă în locul celui din fișă (ex. actualizarea la REV 3), în orice clauză
  const caen = fields.CAEN_1 ?? fields.CAEN_PRINCIPAL_COD
  const caenCod = caen?.split(' - ')[0].trim()
  if (caenCod && caenCod !== client?.caenCod) {
    const caenDescriere = findCaenDescriere(caenCod)
    return {
      label: `CAEN principal: ${caenDescriere ? `${caenCod} - ${caenDescriere}` : caenCod}`,
      patch: { caenCod, caenDescriere },
    }
  }
  return null
}

export default function ClauseSelector({ clauses, client, baseReplacements, onChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fieldsByClause, setFieldsByClause] = useState<Record<string, Record<string, string>>>({})
  const [groupsByClause, setGroupsByClause] = useState<Record<string, Record<string, Record<string, string>[]>>>({})
  const [clientPatchByClause, setClientPatchByClause] = useState<Record<string, ClientPatchProposal | null>>({})

  // O clauză debifată își pierde datele: formularele ei țin alegerea în stare locală (bife, variantă de durată),
  // pierdută la ascundere — valorile rămase ar ajunge în document fără să mai fie vizibile la o nouă bifare.
  const forget = (tags: string[]) => {
    const without = <T,>(prev: Record<string, T>) => Object.fromEntries(Object.entries(prev).filter(([t]) => !tags.includes(t)))
    setFieldsByClause(without)
    setGroupsByClause(without)
    setClientPatchByClause(without)
  }

  const toggle = (tag: string) => {
    const next = new Set(selected)
    if (next.has(tag)) { next.delete(tag); forget([tag]) } else next.add(tag)
    setSelected(next)
  }

  const allSelected = clauses.length > 0 && clauses.every(c => selected.has(c.tag))
  const selectAll = () => setSelected(new Set(clauses.map(c => c.tag)))
  const deselectAll = () => { forget([...selected]); setSelected(new Set()) }

  const setField = (tag: string, key: string, value: string) =>
    setFieldsByClause(prev => ({ ...prev, [tag]: { ...prev[tag], [key]: value } }))

  const setGroup = (tag: string, groupName: string, rows: Record<string, string>[]) =>
    setGroupsByClause(prev => ({ ...prev, [tag]: { ...prev[tag], [groupName]: rows } }))

  const setClientPatch = (tag: string, proposal: ClientPatchProposal | null) =>
    setClientPatchByClause(prev => ({ ...prev, [tag]: proposal }))

  // Condițiile de completare ale unei clauze: câte una pentru fiecare câmp plat, plus una pentru lista repetitivă, dacă are.
  const clauseChecks = (c: ClauseMeta): { label: string; ok: boolean }[] => {
    const spec = findClauseSpec(c.tag, c.placeholders)
    const groupFieldSet = new Set(spec?.groupFields ?? [])
    const checks = c.placeholders
      .filter(ph => !groupFieldSet.has(ph.replace(/^\{\{|\}\}$/g, ''))) // câmpurile din listă se verifică separat, ca grup
      .map(ph => {
        const key = ph.replace(/^\{\{|\}\}$/g, '')
        const v = fieldsByClause[c.tag]?.[key] ?? baseReplacements[ph]
        return { label: ph, ok: !!v && v.trim() !== '' }
      })
    if (spec?.groupName) {
      checks.push({ label: `listă: ${spec.groupName}`, ok: (groupsByClause[c.tag]?.[spec.groupName]?.length ?? 0) > 0 })
    }
    return checks
  }
  const isClauseComplete = (c: ClauseMeta): boolean => clauseChecks(c).every(x => x.ok)

  useEffect(() => {
    const extraReplacements: Record<string, string> = {}
    const extraGroups: Record<string, Record<string, string>[]> = {}
    const clientPatches: Record<string, ClientPatchProposal> = {}
    let complete = selected.size > 0
    const completion = { done: 0, total: 0, missing: [] as string[] }
    for (const tag of selected) {
      const fields = fieldsByClause[tag] ?? {}
      for (const [k, v] of Object.entries(fields)) {
        if (v.trim() !== '') extraReplacements[`{{${k}}}`] = v
      }
      const groups = groupsByClause[tag] ?? {}
      for (const [groupName, rows] of Object.entries(groups)) {
        extraGroups[groupName] = rows
      }
      const patch = clientPatchByClause[tag] ?? computeInlinePatch(fields, client)
      if (patch) clientPatches[tag] = patch
      const clause = clauses.find(c => c.tag === tag)
      if (clause && !isClauseComplete(clause)) complete = false
      if (clause) {
        for (const chk of clauseChecks(clause)) {
          completion.total += 1
          if (chk.ok) completion.done += 1; else completion.missing.push(chk.label)
        }
      }
    }
    onChange({ selectedClauses: [...selected], extraReplacements, extraGroups, clientPatches, isComplete: complete, completion })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, fieldsByClause, groupsByClause, clientPatchByClause, clauses, client])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {clauses.length > 1 && (
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button type="button" className="btn btn-ghost btn-xs" onClick={allSelected ? deselectAll : selectAll}>
            {allSelected ? 'Deselectează tot' : 'Selectează tot'}
          </button>
        </div>
      )}
      {clauses.map(c => {
        const isSelected = selected.has(c.tag)
        const spec = findClauseSpec(c.tag, c.placeholders)
        const useWidget = spec !== null

        return (
          <div key={c.tag} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', cursor: 'pointer',
              background: isSelected ? 'var(--p50)' : 'var(--s50)',
            }}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(c.tag)} />
              <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--s800)' }}>{c.label}</span>
              {isSelected && !isClauseComplete(c) && (
                <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--y700)' }}>⚠️ incomplet</span>
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
                {useWidget && spec.widget === 'majorareCapitalMulti' && (
                  <MajorareCapitalMultiFields
                    client={client}
                    onField={(k, v) => setField(c.tag, k, v)}
                    onRows={rows => setGroup(c.tag, spec.groupName!, rows)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {useWidget && spec.widget === 'asociatiActualizati' && (
                  <ActualizarePersoaneFields client={client} rol="asociat" field="ASOCIATI_ACTUALIZATI" onField={(k, v) => setField(c.tag, k, v)} />
                )}
                {useWidget && spec.widget === 'administratoriActualizati' && (
                  <ActualizarePersoaneFields client={client} rol="administrator" field="ADMINISTRATORI_ACTUALIZATI" onField={(k, v) => setField(c.tag, k, v)} />
                )}
                {useWidget && spec.widget === 'durataSocietate' && (
                  <DurataFields tipuri={['nedeterminata', 'ani', 'data']} onChange={v => setField(c.tag, 'DURATA_SOCIETATE', v)} />
                )}
                {useWidget && spec.widget === 'durataMandat' && (
                  <DurataFields tipuri={['ani', 'data']} onChange={v => setField(c.tag, 'DURATA_MANDAT', v)} />
                )}
                {useWidget && spec.widget === 'identitateAsociat' && (
                  <ModificareIdentitateAsociatFields
                    client={client}
                    fields={fieldsByClause[c.tag] ?? {}}
                    onField={(k, v) => setField(c.tag, k, v)}
                    onClientPatch={p => setClientPatch(c.tag, p)}
                  />
                )}
                {useWidget && spec.widget === 'punctLucruOpen' && (
                  <DeschiderePunctLucruFields
                    client={client}
                    value={fieldsByClause[c.tag]?.PUNCT_LUCRU_NOU_ADRESA ?? ''}
                    onChange={v => setField(c.tag, 'PUNCT_LUCRU_NOU_ADRESA', v)}
                  />
                )}
                {/* Un widget care acoperă doar o parte din clauză (ex. adresa punctului de lucru, dar nu și contractul
                    din Hotărârea AGA de bază) — restul câmpurilor rămân inputuri obișnuite, sub el. */}
                {(!useWidget || spec.widget === 'punctLucruOpen') && (() => {
                  const skip = new Set([...AUTO_DATE_KEYS, ...(useWidget ? spec.fields : [])])
                  const visible = c.placeholders.filter(ph => !skip.has(ph.replace(/^\{\{|\}\}$/g, '')))
                  if (visible.length === 0) {
                    return useWidget ? null : <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Fără alte câmpuri de completat.</div>
                  }
                  return visible.map(ph => {
                    const key = ph.replace(/^\{\{|\}\}$/g, '')
                    const auto = baseReplacements[ph]
                    const { field: label } = parsePlaceholder(ph)
                    const value = fieldsByClause[c.tag]?.[key] ?? auto ?? ''
                    const caenKind = caenFieldKind(key)
                    if (caenKind) {
                      return <CaenFieldInput key={ph} label={label} kind={caenKind} value={value} onChange={v => setField(c.tag, key, v)} />
                    }
                    return isDateLabel(label) ? (
                      <DateFieldInput key={ph} label={label} value={value} onChange={v => setField(c.tag, key, v)} />
                    ) : (
                      <div key={ph} className="field">
                        <label className="field-label">{label}</label>
                        <input
                          className="field-input"
                          value={value}
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
