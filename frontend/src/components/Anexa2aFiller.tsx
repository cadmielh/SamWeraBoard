import { forwardRef, useState } from 'react'
import type { Client } from '../types'
import {
  CATALOG_41, CATALOG_42, PUNCTE, PUNCTE_CU_FIRMA, OPIS_RANDURI,
  buildAnexa2aDocxData, stareInitiala, verificari, avertismente, persoaneCandidat,
} from '../lib/anexa2aFiller'
import type { Anexa2aFormState, Punct, Puteri, SectiuneId, SediuSucursala } from '../lib/anexa2aFiller'
import { EMPTY_PERSOANA, dateFacturare, elementeAlese, persoanaComunicare, persoanaDinBuletin, totalFile } from '../lib/onrcCommon'
import type { PersoanaA2A } from '../lib/onrcCommon'
import type { IDFields } from '../lib/api'
import type { ElRef } from '../lib/useFieldRefs'
import MiniOCR from './MiniOCR'
import {
  AdresaRow, CatalogFields, Check, Chips, ComunicareFields, DeponentFields, FacturareFields, Field, FieldDate, FirmaFields,
  PersoanaFields, SubTitle, SubsemnatFields,
} from './OnrcFormKit'
import { AUTO_NOTE, NOTE, ROW } from './onrcFormStyles'
import { useOnrcForm } from './useOnrcForm'
import type { OnrcFormHandle, OnrcFormValue } from './useOnrcForm'

export type Anexa2aFormValue = OnrcFormValue<Anexa2aFormState>
export type Anexa2aFillerHandle = OnrcFormHandle

interface Props {
  client?: Partial<Client> | null
  /** Starea salvată dintr-o deschidere anterioară (același client); lipsă = precompletare din fișă. */
  initial?: Anexa2aFormState
  onChange: (value: Anexa2aFormValue) => void
}

/** Datele citite dintr-un buletin, pentru reprezentantul persoanei juridice străine (doar nume și act). */
const dinBuletin = (f: IDFields): PersoanaA2A => persoanaDinBuletin({ ...EMPTY_PERSOANA }, f)

const CALITATI = ['administrator', 'asociat', 'împuternicit', 'avocat']
const TEMEIURI = ['Hotărârea AGA nr. … din …', 'Decizia asociatului unic nr. … din …', 'Actul constitutiv', 'Decizia C.A. nr. … din …']
const ACTE_OPIS = [
  'Act constitutiv actualizat', 'Declarație pe propria răspundere (Anexa 4)', 'Dovada sediului social',
  'Declarație beneficiari reali', 'Împuternicire avocațială', 'Specimen de semnătură', 'Dovada achitării taxelor',
]

// ── Sucursale (doar Anexa 2a) ───────────────────────────────────────────────────────────────────────────────────────

export function SediuSucursalaFields({ value, onChange, fieldRefs }: {
  value: SediuSucursala; onChange: (v: SediuSucursala) => void; fieldRefs?: Partial<Record<'firma' | 'loc', ElRef>>
}) {
  const set = (k: keyof SediuSucursala, v: string) => onChange({ ...value, [k]: v })
  return (
    <>
      <Field label="Firma sucursalei" value={value.firma} onChange={v => set('firma', v)} fieldRef={fieldRefs?.firma} />
      <div ref={fieldRefs?.loc} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <AdresaRow v={value} set={(k, v) => set(k, v)} />
      </div>
      <div style={ROW}>
        <Field label="E-mail" value={value.email} onChange={v => set('email', v)} />
        <Field label="Telefon" value={value.tel} onChange={v => set('tel', v)} />
      </div>
    </>
  )
}

export function PuteriChoice({ value, onChange, fieldRef }: { value: Puteri; onChange: (v: Puteri) => void; fieldRef?: ElRef }) {
  return (
    <div className="field">
      <label className="field-label">Puterile conferite se exercită</label>
      <Chips<'impreuna' | 'separat'> fieldRef={fieldRef} value={value ? [value] : []} onChange={v => onChange(v[0] ?? '')}
        options={[{ value: 'impreuna', label: 'Împreună' }, { value: 'separat', label: 'Separat' }]} />
    </div>
  )
}

// ── Formularul ──────────────────────────────────────────────────────────────────────────────────────────────────────

const Anexa2aFiller = forwardRef<OnrcFormHandle, Props>(function Anexa2aFiller({ client, initial, onChange }, ref) {
  const [s, setS] = useState<Anexa2aFormState>(() => initial ?? stareInitiala(client))
  // `patch` pornește de la starea curentă (prev), dar valorile din `p` sunt calculate din randarea curentă: două
  // apeluri succesive în același eveniment trebuie să folosească forma funcțională (vezi PersoanaFields).
  const patch = (p: Partial<Anexa2aFormState>) => setS(prev => ({ ...prev, ...p }))
  const candidati = persoaneCandidat(client)
  const are = (n: Punct) => s.puncte.includes(n)
  const cuFirma = PUNCTE_CU_FIRMA.some(are)

  // Secțiunile afișate, în ordinea documentului (punctele din V apar doar dacă sunt alese).
  const sectiuni: SectiuneId[] = [
    'antet', 'iv', 'v', ...(cuFirma ? ['firma' as const] : []),
    ...([2, 3, 4, 5, 6, 7, 8] as Punct[]).filter(are).map(n => `p${n}` as SectiuneId),
    'vi', 'vii', 'viii', 'ix', 'semnare',
  ]
  const { sec, bindRef } = useOnrcForm({ ref, state: s, build: buildAnexa2aDocxData, verificari, onChange, sectiuni, deschisInitial: 'v' })

  const numeSub = `${s.sub.nume} ${s.sub.prenume}`.trim()
  const com = persoanaComunicare(s)
  const fact = dateFacturare(s)
  const ales41 = elementeAlese(CATALOG_41, s.s41).length
  const ales42 = elementeAlese(CATALOG_42, s.s42).length
  const warn = avertismente(s)

  const setOpisRand = (i: number, p: Partial<Anexa2aFormState['opis']['randuri'][number]>) =>
    patch({ opis: { ...s.opis, randuri: s.opis.randuri.map((r, j) => j === i ? { ...r, ...p } : r) } })
  const adaugaInOpis = (den: string) => {
    const i = s.opis.randuri.findIndex((r, j) => j > 0 && !r.den.trim())
    if (i !== -1) setOpisRand(i, { den })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {sec('antet', 'I–III.', 'Oficiul registrului comerțului', s.orcTribunal ? `ORC de pe lângă Tribunalul ${s.orcTribunal}` : undefined, (
        <>
          <Field label="Oficiul registrului comerțului de pe lângă Tribunalul" value={s.orcTribunal}
            onChange={v => patch({ orcTribunal: v.toLocaleUpperCase('ro-RO') })} fieldRef={bindRef('orc')} />
          <div style={NOTE}>Tipul cererii (secțiunea II) se bifează singur, după punctele alese la V. Numărul și data (III) le pune ONRC.</div>
        </>
      ))}

      {sec('iv', 'IV.', 'Subsemnatul(a)', numeSub ? `${numeSub}${s.subCalitate ? ` · ${s.subCalitate}` : ''}` : undefined, (
        <SubsemnatFields value={s} update={f => setS(prev => ({ ...prev, ...f(prev) }))} candidati={candidati} calitati={CALITATI} bindRef={bindRef}
          nota="Nota 1: poate semna reprezentantul legal, un împuternicit cu procură autentică, avocatul (cu împuternicire avocațială) sau orice asociat." />
      ))}

      {sec('v', 'V.', 'Obiectul cererii', s.puncte.length ? `${s.puncte.length === 1 ? 'punctul' : 'punctele'} ${s.puncte.join(', ')}` : undefined, (
        <>
          <div className="field">
            <label className="field-label">Prevăzut în (actul care stă la baza cererii — nota 2)</label>
            <input className="field-input" value={s.actTemei} onChange={e => patch({ actTemei: e.target.value })} placeholder="ex. Hotărârea AGA nr. 1 din 10.11.2026" />
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
              {TEMEIURI.map(t => <button key={t} type="button" className="btn btn-ghost btn-xs" onClick={() => patch({ actTemei: t })}>{t}</button>)}
            </div>
          </div>
          <div className="field" ref={bindRef('puncte')}>
            <label className="field-label">Ce se cere (se pot alege mai multe)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
              {PUNCTE.map(p => (
                <Check key={p.nr} label={<><b>{p.nr}.</b> {p.label}</>} checked={are(p.nr)}
                  onChange={v => patch({ puncte: v ? [...s.puncte, p.nr].sort() as Punct[] : s.puncte.filter(x => x !== p.nr) })} />
              ))}
            </div>
          </div>
          <div style={NOTE}>Fiecare punct ales apare mai jos, ca secțiune separată. Punctele nealese rămân necompletate (cu puncte) în document, ca în formularul oficial.</div>
        </>
      ))}

      {cuFirma && sec('firma', '', 'Datele firmei', s.firma.firma || undefined, (
        <FirmaFields firma={s.firma} update={f => setS(prev => ({ ...prev, firma: f(prev.firma) }))} bindRef={bindRef}
          cuNrReg={s.puncte.some(n => n !== 1 && PUNCTE_CU_FIRMA.includes(n))} sediu="Sediul social"
          nota={`Completat din fișa clientului — verifică. Se folosesc la punctele ${PUNCTE_CU_FIRMA.filter(are).join(', ')}.`} />
      ))}

      {are(2) && sec('p2', '2.', 'Sucursală persoană juridică română', s.s2.sediu.firma || undefined, (
        <>
          <SediuSucursalaFields value={s.s2.sediu} onChange={sediu => patch({ s2: { ...s.s2, sediu } })}
            fieldRefs={{ firma: bindRef('s2-firma'), loc: bindRef('s2-loc') }} />
          <SubTitle>Reprezentantul persoanei juridice care deschide sucursala</SubTitle>
          <div ref={bindRef('s2-rd')} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <PersoanaFields candidati={candidati} value={s.s2.rd} sursa={s.s2.rdSursa}
              onChange={rd => setS(prev => ({ ...prev, s2: { ...prev.s2, rd } }))}
              onSursa={rdSursa => setS(prev => ({ ...prev, s2: { ...prev.s2, rdSursa } }))} />
          </div>
          <SubTitle>Reprezentantul care se ocupă nemijlocit de activitatea sucursalei</SubTitle>
          <div ref={bindRef('s2-rn')} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <PersoanaFields candidati={candidati} value={s.s2.rn} sursa={s.s2.rnSursa}
              onChange={rn => setS(prev => ({ ...prev, s2: { ...prev.s2, rn } }))}
              onSursa={rnSursa => setS(prev => ({ ...prev, s2: { ...prev.s2, rnSursa } }))} />
          </div>
          <PuteriChoice value={s.s2.puteri} onChange={puteri => patch({ s2: { ...s.s2, puteri } })} fieldRef={bindRef('s2-puteri')} />
          <SubTitle>Persoana juridică ce deschide sucursala</SubTitle>
          <div style={ROW}>
            <Field label="Înregistrată la ORCT" value={s.s2.pjOrct} onChange={v => patch({ s2: { ...s.s2, pjOrct: v } })} />
            <Field label="Denumire" flex={2} value={s.s2.pjDen} onChange={v => patch({ s2: { ...s.s2, pjDen: v } })} />
          </div>
          <div style={ROW}>
            <Field label="Nr. de înmatriculare" value={s.s2.pjNrReg} onChange={v => patch({ s2: { ...s.s2, pjNrReg: v } })} />
            <Field label="CUI" value={s.s2.pjCui} onChange={v => patch({ s2: { ...s.s2, pjCui: v } })} />
          </div>
        </>
      ))}

      {are(3) && sec('p3', '3.', 'Sucursală persoană juridică străină', s.s3.sediu.firma || undefined, (
        <>
          <SubTitle>Persoana juridică din străinătate</SubTitle>
          <Field label="Firma și forma juridică" value={s.s3.pjsFirma} onChange={v => patch({ s3: { ...s.s3, pjsFirma: v } })} fieldRef={bindRef('s3-pjs')} />
          <div style={ROW}>
            <Field label="Înmatriculată în registrul din țara" value={s.s3.pjsTara} onChange={v => patch({ s3: { ...s.s3, pjsTara: v } })} fieldRef={bindRef('s3-tara')} />
            <Field label="Nr. de înregistrare" value={s.s3.pjsNrReg} onChange={v => patch({ s3: { ...s.s3, pjsNrReg: v } })} />
            <Field label="EUID" value={s.s3.pjsEuid} onChange={v => patch({ s3: { ...s.s3, pjsEuid: v } })} />
          </div>
          <SubTitle>Reprezentantul persoanei juridice din străinătate</SubTitle>
          {(() => {
            const rs = s.s3.rs
            const setRs = (k: keyof typeof rs, v: string) => patch({ s3: { ...s.s3, rs: { ...rs, [k]: v } } })
            return (
              <>
                <MiniOCR compact onExtracted={f => {
                  const b = dinBuletin(f)
                  setS(prev => ({ ...prev, s3: { ...prev.s3, rs: { ...prev.s3.rs,
                    nume: b.nume || prev.s3.rs.nume, prenume: b.prenume || prev.s3.rs.prenume,
                    actTip: b.actSeria ? 'CI' : prev.s3.rs.actTip, actSeria: b.actSeria || prev.s3.rs.actSeria, actNr: b.actNr || prev.s3.rs.actNr,
                    actEmis: b.actEmis || prev.s3.rs.actEmis, actData: b.actData || prev.s3.rs.actData, actValabil: b.actValabil || prev.s3.rs.actValabil,
                  } } }))
                }} />
                <div style={ROW}>
                  <Field label="Nume" value={rs.nume} onChange={v => setRs('nume', v)} />
                  <Field label="Prenume" value={rs.prenume} onChange={v => setRs('prenume', v)} />
                  <Field label="În calitate de" value={rs.calitate} onChange={v => setRs('calitate', v)} />
                </div>
                <div style={ROW}>
                  <Field label="Act identitate" minWidth={80} value={rs.actTip} onChange={v => setRs('actTip', v)} />
                  <Field label="Seria" minWidth={70} value={rs.actSeria} onChange={v => setRs('actSeria', v)} />
                  <Field label="Nr." value={rs.actNr} onChange={v => setRs('actNr', v)} />
                  <Field label="Emis(ă) de" flex={2} value={rs.actEmis} onChange={v => setRs('actEmis', v)} />
                </div>
                <div style={ROW}>
                  <FieldDate label="La data" value={rs.actData} onChange={v => setRs('actData', v)} />
                  <FieldDate label="Valabil până la" value={rs.actValabil} onChange={v => setRs('actValabil', v)} />
                </div>
              </>
            )
          })()}
          <SubTitle>Sucursala</SubTitle>
          <SediuSucursalaFields value={s.s3.sediu} onChange={sediu => patch({ s3: { ...s.s3, sediu } })} fieldRefs={{ firma: bindRef('s3-firma') }} />
          <SubTitle>Reprezentanții care se ocupă nemijlocit de activitatea sucursalei</SubTitle>
          <div ref={bindRef('s3-rn')} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <PersoanaFields candidati={candidati} value={s.s3.rn} sursa={s.s3.rnSursa}
              onChange={rn => setS(prev => ({ ...prev, s3: { ...prev.s3, rn } }))}
              onSursa={rnSursa => setS(prev => ({ ...prev, s3: { ...prev.s3, rnSursa } }))} />
          </div>
          <PuteriChoice value={s.s3.puteri} onChange={puteri => patch({ s3: { ...s.s3, puteri } })} fieldRef={bindRef('s3-puteri')} />
          <Field label="Legea națională aplicabilă (doar pentru state din afara UE/SEE)" value={s.s3.lege} onChange={v => patch({ s3: { ...s.s3, lege: v } })} />
        </>
      ))}

      {are(4) && sec('p4', '4.', 'Înscriere mențiuni', [ales41 && `${ales41} mențiuni`, ales42 && `${ales42} acte`, s.s43 && 'declarație'].filter(Boolean).join(' · ') || undefined, (
        <>
          <div ref={bindRef('s4-ceva')} style={{ fontWeight: 700, fontSize: '.78rem', color: 'var(--s600)' }}>4.1. Acte și fapte pentru care legea prevede obligația înscrierii</div>
          <CatalogFields catalog={CATALOG_41} stare={s.s41} onChange={s41 => patch({ s41 })} />
          <div style={{ fontWeight: 700, fontSize: '.78rem', color: 'var(--s600)', marginTop: '.25rem' }}>4.2. Depunere de acte</div>
          <CatalogFields catalog={CATALOG_42} stare={s.s42} onChange={s42 => patch({ s42 })} />
          <Check label={<><b>4.3.</b> Declarație pe propria răspundere cu privire la îndeplinirea condițiilor de funcționare</>}
            checked={s.s43} onChange={v => patch({ s43: v })} />
        </>
      ))}

      {are(5) && sec('p5', '5.', 'Operațiuni comunicate de autoritate/instituție publică', s.s5Autoritate || undefined, (
        <Field label="Autoritatea / instituția publică" value={s.s5Autoritate} onChange={v => patch({ s5Autoritate: v })} fieldRef={bindRef('s5-autoritate')} />
      ))}

      {are(6) && sec('p6', '6.', 'Radiere', undefined, (
        <>
          <div className="field">
            <label className="field-label">Se radiază</label>
            <Chips<'PJ' | 'SUC_RO' | 'SUC_STR'> fieldRef={bindRef('s6-tip')} value={s.s6.tip ? [s.s6.tip] : []}
              onChange={v => patch({ s6: { ...s.s6, tip: v[0] ?? '' } })}
              options={[{ value: 'PJ', label: 'Persoană juridică' }, { value: 'SUC_RO', label: 'Sucursală PJ română' }, { value: 'SUC_STR', label: 'Sucursală PJ străină' }]} />
          </div>
          <div className="field">
            <label className="field-label">Motiv</label>
            <Chips<'VOINTA' | 'HOTARARE' | 'INCETARE' | 'ALTELE'> fieldRef={bindRef('s6-motiv')} value={s.s6.motiv ? [s.s6.motiv] : []}
              onChange={v => patch({ s6: { ...s.s6, motiv: v[0] ?? '' } })}
              options={[{ value: 'VOINTA', label: 'Voința profesionistului' }, { value: 'HOTARARE', label: 'Hotărâre judecătorească' },
                { value: 'INCETARE', label: 'Încetare activitate sucursală' }, { value: 'ALTELE', label: 'Altele' }]} />
          </div>
          {s.s6.motiv === 'ALTELE' && <Field label="Alt motiv" value={s.s6.motivAltele} onChange={v => patch({ s6: { ...s.s6, motivAltele: v } })} />}
          <Check label="Menționare depunere raport repartizare activ rămas în urma lichidării" checked={s.s6.raport} onChange={v => patch({ s6: { ...s.s6, raport: v } })} />
        </>
      ))}

      {are(7) && sec('p7', '7.', 'Îndreptare eroare materială', s.s7.act || undefined, (
        <>
          <Field label="Referitoare la actul" value={s.s7.act} onChange={v => patch({ s7: { ...s.s7, act: v } })} fieldRef={bindRef('s7-act')} />
          <Field label="Pentru cererea/cererile nr./data" value={s.s7.cerere} onChange={v => patch({ s7: { ...s.s7, cerere: v } })} />
          <Chips<'INMATRICULARE' | 'MENTIUNE' | 'RADIERE'> multi value={s.s7.tipCerere} onChange={tipCerere => patch({ s7: { ...s.s7, tipCerere } })}
            options={[{ value: 'INMATRICULARE', label: 'Înmatriculare' }, { value: 'MENTIUNE', label: 'Mențiune' }, { value: 'RADIERE', label: 'Radiere' }]} />
          <Field label="În loc de" value={s.s7.inLocDe} onChange={v => patch({ s7: { ...s.s7, inLocDe: v } })} />
          <Field label="Se va înregistra" value={s.s7.seVa} onChange={v => patch({ s7: { ...s.s7, seVa: v } })} fieldRef={bindRef('s7-seva')} />
        </>
      ))}

      {are(8) && sec('p8', '8.', 'Actualizare obiect de activitate CAEN Rev. 3', s.s8Obiect || undefined, (
        <>
          <Field label="Obiect de activitate principal (clasa + denumire)" value={s.s8Obiect} onChange={v => patch({ s8Obiect: v })} fieldRef={bindRef('s8-obiect')} />
          <div style={NOTE}>Nota 8: doar când obiectul de activitate din actul constitutiv nu se schimbă; nu se depune act constitutiv actualizat.</div>
        </>
      ))}

      {sec('vi', 'VI.', 'Solicit', [s.vi.audienta && 'audiență', s.vi.copii && 'copii', s.vi.copiiCert && 'copii certificate', s.vi.comunicare && 'comunicare'].filter(Boolean).join(', ') || undefined, (
        <>
          <Check label="Audiență publică" checked={s.vi.audienta} onChange={v => patch({ vi: { ...s.vi, audienta: v } })} />
          <Check label="Copii" checked={s.vi.copii} onChange={v => patch({ vi: { ...s.vi, copii: v } })} />
          <Check label="Copii certificate de pe documentele" checked={s.vi.copiiCert} onChange={v => patch({ vi: { ...s.vi, copiiCert: v } })} />
          {s.vi.copiiCert && <Field label="Care documente" value={s.vi.copiiCertDoc} onChange={v => patch({ vi: { ...s.vi, copiiCertDoc: v } })} />}
          <Check label="Comunicarea documentelor care atestă înregistrarea, într-o singură modalitate" checked={s.vi.comunicare} onChange={v => patch({ vi: { ...s.vi, comunicare: v } })} />
          {s.vi.comunicare && (
            <>
              <Chips<'POSTA' | 'CURIER' | 'ELECTRONIC' | 'SEDIU_ORCT'> fieldRef={bindRef('vi-modalitate')} value={s.vi.modalitate ? [s.vi.modalitate] : []}
                onChange={v => patch({ vi: { ...s.vi, modalitate: v[0] ?? '' } })}
                options={[{ value: 'POSTA', label: 'Poștă' }, { value: 'CURIER', label: 'Curier' }, { value: 'ELECTRONIC', label: 'Mijloace electronice' }, { value: 'SEDIU_ORCT', label: 'Sediul O.R.C.T.' }]} />
              {s.vi.modalitate === 'SEDIU_ORCT' && <Field label="Sediul O.R.C.T." value={s.vi.sediuOrct} onChange={v => patch({ vi: { ...s.vi, sediuOrct: v } })} />}
            </>
          )}
        </>
      ))}

      {sec('vii', 'VII.', 'Persoana pentru comunicare', `${com.nume} ${com.prenume}`.trim() || undefined, (
        <ComunicareFields com={s.com} sub={s.sub} update={f => setS(prev => ({ ...prev, com: f(prev.com) }))} />
      ))}

      {sec('viii', 'VIII.', 'Date de facturare', s.fact.sursa === 'niciuna' ? 'pe plătitor' : fact.nume || undefined, (
        <FacturareFields fact={s.fact} rezolvat={fact} update={f => setS(prev => ({ ...prev, fact: f(prev.fact) }))} nota="Nota 9" />
      ))}

      {sec('ix', 'IX.', 'Opis de documente depuse', (() => {
        const n = s.opis.randuri.filter(r => r.den.trim()).length
        const t = totalFile(s.opis.randuri)
        return n ? `${n} documente${t ? ` · ${t} file` : ''}` : undefined
      })(), (
        <>
          <div style={NOTE}>Rândul 1 e pentru hotărârea AGA / decizia CA (actul care se publică în Monitorul Oficial). Rândurile goale rămân goale în tabel.</div>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {s.actTemei.trim() && !s.opis.randuri[0].den.trim() && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpisRand(0, { den: s.actTemei.trim() })}>Rândul 1: {s.actTemei.trim()}</button>
            )}
            {ACTE_OPIS.filter(a => !s.opis.randuri.some(r => r.den === a)).map(a => (
              <button key={a} type="button" className="btn btn-ghost btn-xs" onClick={() => adaugaInOpis(a)}>+ {a}</button>
            ))}
          </div>
          {s.opis.randuri.slice(0, OPIS_RANDURI).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.4rem', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '.78rem', fontWeight: 700, width: '1.2rem', paddingBottom: '.45rem' }}>{i + 1}.</span>
              <Field label={i === 0 ? 'Hotărâre AGA / Decizie CA' : 'Denumirea actului'} flex={3} value={r.den} onChange={v => setOpisRand(i, { den: v })} />
              <Field label="Nr. și data / emitent" flex={2} value={r.nrData} onChange={v => setOpisRand(i, { nrData: v })} />
              <Field label="File" flex={0} minWidth={60} value={r.file} onChange={v => setOpisRand(i, { file: v })} />
            </div>
          ))}
          <div style={ROW}>
            <Field label="Actul pentru Monitorul Oficial conține … caractere" value={s.opis.caractere} onChange={v => patch({ opis: { ...s.opis, caractere: v } })} />
            <Field label="… pagini manuscris" value={s.opis.pagini} onChange={v => patch({ opis: { ...s.opis, pagini: v } })} />
          </div>
          <div style={NOTE}>Nota 10: o pagină de manuscris are 2.000 de semne, cu spații. Total file: {totalFile(s.opis.randuri) || '—'}.</div>
        </>
      ))}

      {sec('semnare', 'X–XII.', 'Semnare și depunere', s.dataSemnare ? `data ${s.dataSemnare}${s.dep.activ ? ' · depune altă persoană' : ''}` : undefined, (
        <>
          <div style={ROW}>
            <FieldDate label="Data (X și XI)" value={s.dataSemnare} onChange={v => patch({ dataSemnare: v })} showToday />
            <Field label="Anexele nr. (XI)" value={s.anexe} onChange={v => patch({ anexe: v })} placeholder="ex. 1, 3, 4" />
          </div>
          <div style={NOTE}>La X apare numele subsemnatului ({numeSub || '—'}). Data goală rămâne de completat de mână.</div>
          <DeponentFields dep={s.dep} update={f => setS(prev => ({ ...prev, dep: f(prev.dep) }))} bindRef={bindRef}
            eticheta="XII. Cererea o depune altă persoană decât semnatarul (nota 12)" />
        </>
      ))}

      {warn.length > 0 && (
        <div style={{ ...AUTO_NOTE, fontSize: '.78rem' }}>
          {warn.map(w => <div key={w}>⚠️ {w}</div>)}
        </div>
      )}
    </div>
  )
})

export default Anexa2aFiller
