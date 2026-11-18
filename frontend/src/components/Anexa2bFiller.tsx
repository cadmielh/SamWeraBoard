import { forwardRef, useState } from 'react'
import type { Client } from '../types'
import { dateFacturare, elementeAlese, persoanaComunicare, totalFile } from '../lib/onrcCommon'
import {
  CATALOG_21, CATALOG_22, CAEN_RANDURI, ENTITATI, MEMBRI_RANDURI, OPIS_RANDURI_2B, OPIS_TIPARITE, PUNCTE_2B,
  avertismente2b, buildAnexa2bDocxData, calitateTitular, claseCompletate, listaCaenActiva, persoaneCandidatPF,
  stareInitiala2b, verificari2b,
} from '../lib/anexa2bFiller'
import type { Anexa2bFormState, ClasaCaen, ListaCaen, MembruIF, ModVII, Punct2b, Sectiune2b } from '../lib/anexa2bFiller'
import {
  CatalogFields, Check, Chips, ComunicareFields, DeponentFields, FacturareFields, Field, FieldDate, FirmaFields,
  PersoanaFields, SubTitle, SubsemnatFields,
} from './OnrcFormKit'
import { AUTO_NOTE, NOTE, ROW } from './onrcFormStyles'
import { useOnrcForm } from './useOnrcForm'
import type { OnrcFormHandle, OnrcFormValue } from './useOnrcForm'

export type Anexa2bFormValue = OnrcFormValue<Anexa2bFormState>
export type Anexa2bFillerHandle = OnrcFormHandle

interface Props {
  client?: Partial<Client> | null
  /** Starea salvată dintr-o deschidere anterioară (același client); lipsă = precompletare din fișă. */
  initial?: Anexa2bFormState
  onChange: (value: Anexa2bFormValue) => void
}

const CALITATI = ['persoană fizică autorizată', 'titular', 'reprezentant', 'membru', 'împuternicit', 'avocat']
const TEMEIURI = ['Acord de constituire', 'Declarație pe propria răspundere', 'Declarația privind participarea soției/soțului la activitate']
const ACTE_OPIS = ['Copie act de identitate', 'Specimen de semnătură', 'Dovada achitării taxelor', 'Procură specială', 'Împuternicire avocațială']
const LISTE_CAEN: { l: ListaCaen; label: string }[] = [
  { l: 'inreg', label: 'Înregistrare' }, { l: 'renuntare', label: 'Renunțare' }, { l: 'completare', label: 'Completare' },
]

/** Un tabel CAEN (clasă + denumire) pe rânduri fixe, ca în formular. */
function TabelCaen({ randuri, onChange }: { randuri: ClasaCaen[]; onChange: (r: ClasaCaen[]) => void }) {
  const set = (i: number, p: Partial<ClasaCaen>) => onChange(randuri.map((r, j) => j === i ? { ...r, ...p } : r))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
      {randuri.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: '.4rem' }}>
          <input className="field-input" style={{ width: 80, flex: 'none' }} placeholder="Clasa" value={r.cod} onChange={e => set(i, { cod: e.target.value })} />
          <input className="field-input" style={{ flex: 1, minWidth: 0 }} placeholder="Denumire" value={r.den} onChange={e => set(i, { den: e.target.value })} />
        </div>
      ))}
    </div>
  )
}

// ── Formularul ──────────────────────────────────────────────────────────────────────────────────────────────────────

const Anexa2bFiller = forwardRef<OnrcFormHandle, Props>(function Anexa2bFiller({ client, initial, onChange }, ref) {
  const [s, setS] = useState<Anexa2bFormState>(() => initial ?? stareInitiala2b(client))
  // `patch` pornește de la starea curentă (prev), dar valorile din `p` sunt calculate din randarea curentă: două
  // apeluri succesive în același eveniment trebuie să folosească forma funcțională (vezi PersoanaFields).
  const patch = (p: Partial<Anexa2bFormState>) => setS(prev => ({ ...prev, ...p }))
  const candidati = persoaneCandidatPF(client)
  const are = (n: Punct2b) => s.puncte.includes(n)
  const isIF = s.entitate === 'IF'

  // Secțiunile afișate, în ordinea documentului (punctele din VI apar doar dacă sunt alese, V doar la IF).
  const sectiuni: Sectiune2b[] = [
    'antet', 'iv', ...(isIF ? ['v' as const] : []), 'vi', ...(s.puncte.length ? ['firma' as const] : []),
    ...([2, 3, 4, 5] as Punct2b[]).filter(are).map(n => `p${n}` as Sectiune2b),
    'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'semnare',
  ]
  const { sec, bindRef } = useOnrcForm({ ref, state: s, build: buildAnexa2bDocxData, verificari: verificari2b, onChange, sectiuni, deschisInitial: 'vi' })

  const setMembru = (i: number, p: Partial<MembruIF>) =>
    setS(prev => ({ ...prev, membri: prev.membri.map((m, j) => j === i ? { ...m, ...p } : m) }))
  const setVii = (p: Partial<Anexa2bFormState['vii']>) => setS(prev => ({ ...prev, vii: { ...prev.vii, ...p } }))
  const numeSub = `${s.sub.nume} ${s.sub.prenume}`.trim()
  const com = persoanaComunicare(s)
  const fact = dateFacturare(s)
  const ales21 = elementeAlese(CATALOG_21, s.s21).length
  const ales22 = elementeAlese(CATALOG_22, s.s22).length
  const warn = avertismente2b(s, client)
  const doarActualizare = s.vii.moduri.length === 1 && s.vii.moduri[0] === 'ACTUALIZARE'
  const entLabel = ENTITATI.find(e => e.value === s.entitate)?.label

  const setOpisRand = (i: number, p: Partial<Anexa2bFormState['opis'][number]>) =>
    patch({ opis: s.opis.map((r, j) => j === i ? { ...r, ...p } : r) })
  const adaugaInOpis = (den: string) => {
    const i = s.opis.findIndex((r, j) => j >= OPIS_TIPARITE.length && !r.den.trim())
    if (i !== -1) setOpisRand(i, { den })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {sec('antet', 'I–III.', 'Oficiul registrului comerțului și forma', [s.orcTribunal && `ORC ${s.orcTribunal}`, entLabel].filter(Boolean).join(' · ') || undefined, (
        <>
          <Field label="Oficiul registrului comerțului de pe lângă Tribunalul" value={s.orcTribunal}
            onChange={v => patch({ orcTribunal: v.toLocaleUpperCase('ro-RO') })} fieldRef={bindRef('orc')} />
          <div className="field" ref={bindRef('entitate')}>
            <label className="field-label">Forma</label>
            <Chips value={s.entitate ? [s.entitate] : []} onChange={v => setS(prev => {
              const entitate = v[0] ?? ''
              // Calitatea titularului urmează forma, cât timp e cea propusă automat (nu una scrisă de mână).
              const auto = prev.subSursa === 'titular' && prev.subCalitate === calitateTitular(prev.entitate)
              return { ...prev, entitate, subCalitate: auto ? calitateTitular(entitate) : prev.subCalitate }
            })}
              options={ENTITATI.map(e => ({ value: e.value, label: e.label }))} />
          </div>
          <div style={NOTE}>Tipul cererii (secțiunea II) se bifează singur, după punctele alese la VI și după rubrica VII. Numărul și data (III) le pune ONRC.</div>
        </>
      ))}

      {sec('iv', 'IV.', 'Subsemnatul(a)', numeSub ? `${numeSub}${s.subCalitate ? ` · ${s.subCalitate}` : ''}` : undefined, (
        <SubsemnatFields value={s} update={f => setS(prev => ({ ...prev, ...f(prev) }))} candidati={candidati} calitati={CALITATI} bindRef={bindRef}
          nota={`Nota 1: semnează ${s.entitate === 'IF' ? 'reprezentantul desemnat prin acordul de constituire' : s.entitate === 'II' ? 'titularul întreprinderii individuale' : 'persoana care se înregistrează ca PFA'}, personal, prin împuternicit cu procură autentică sau prin avocat.`} />
      ))}

      {isIF && sec('v', 'V.', 'Membri întreprindere familială', s.membri.filter(m => m.sursa).map(m => `${m.p.nume} ${m.p.prenume}`.trim()).join(', ') || undefined, (
        <>
          {s.membri.slice(0, MEMBRI_RANDURI).map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <SubTitle>Membrul {i + 1}</SubTitle>
              <PersoanaFields candidati={candidati.filter(c => c.id !== s.subSursa)} value={m.p} sursa={m.sursa}
                onChange={p => setMembru(i, { p })}
                onSursa={(sursa, calitate) => setMembru(i, { sursa, calitate: calitate || 'membru' })} />
              {m.sursa && (
                <>
                  <div style={ROW}>
                    <Field label="Regimul matrimonial (după caz)" value={m.regim} onChange={v => setMembru(i, { regim: v })} />
                    <Field label="În calitate de" value={m.calitate} onChange={v => setMembru(i, { calitate: v })} />
                  </div>
                  <div style={ROW}>
                    <Field label="Prin (dacă e cazul)" value={m.prin} onChange={v => setMembru(i, { prin: v })} />
                    <Field label="Conform" flex={2} value={m.conform} onChange={v => setMembru(i, { conform: v })} />
                  </div>
                </>
              )}
            </div>
          ))}
          <div style={NOTE}>Nota 2: dacă sunt mai mult de doi membri, ceilalți se trec într-o anexă, cu aceleași date. Un rând fără persoană aleasă rămâne cu puncte.</div>
        </>
      ))}

      {sec('vi', 'VI.', 'Obiectul cererii', s.puncte.length ? `${s.puncte.length === 1 ? 'punctul' : 'punctele'} ${s.puncte.join(', ')}` : undefined, (
        <>
          <div className="field">
            <label className="field-label">Prevăzut în (actul care stă la baza cererii — nota 3)</label>
            <input className="field-input" value={s.actTemei} onChange={e => patch({ actTemei: e.target.value })} placeholder="ex. acordul de constituire din 10.11.2026" />
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
              {TEMEIURI.map(t => <button key={t} type="button" className="btn btn-ghost btn-xs" onClick={() => patch({ actTemei: t })}>{t}</button>)}
            </div>
          </div>
          <div className="field" ref={bindRef('puncte')}>
            <label className="field-label">Ce se cere (se pot alege mai multe)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
              {PUNCTE_2B.map(p => (
                <Check key={p.nr} label={<><b>{p.nr}.</b> {p.label}</>} checked={are(p.nr)}
                  onChange={v => patch({ puncte: v ? [...s.puncte, p.nr].sort() as Punct2b[] : s.puncte.filter(x => x !== p.nr) })} />
              ))}
            </div>
          </div>
          {are(1) && <div style={NOTE}>Nota 4: la înregistrare se depune și declarația pe propria răspundere privind îndeplinirea condițiilor de funcționare (Anexa nr. 1).</div>}
          <div style={NOTE}>Fiecare punct ales apare mai jos, ca secțiune separată. Punctele nealese rămân necompletate (cu puncte) în document, ca în formularul oficial.</div>
        </>
      ))}

      {s.puncte.length > 0 && sec('firma', '', 'Datele firmei', s.firma.firma || undefined, (
        <FirmaFields firma={s.firma} update={f => setS(prev => ({ ...prev, firma: f(prev.firma) }))} bindRef={bindRef}
          cuNrReg={s.puncte.some(n => n !== 1)} sediu="Sediul profesional"
          nota={`Completat din fișa clientului — verifică. Se folosesc la punctele ${s.puncte.join(', ')}.`} />
      ))}

      {are(2) && sec('p2', '2.', 'Înscriere mențiuni', [ales21 && `${ales21} mențiuni`, ales22 && `${ales22} acte`, s.s23 && 'declarație'].filter(Boolean).join(' · ') || undefined, (
        <>
          <div ref={bindRef('s2-ceva')} style={{ fontWeight: 700, fontSize: '.78rem', color: 'var(--s600)' }}>2.1. Acte și fapte pentru care legea prevede obligația înscrierii</div>
          <CatalogFields catalog={CATALOG_21} stare={s.s21} onChange={s21 => patch({ s21 })} />
          <div style={{ fontWeight: 700, fontSize: '.78rem', color: 'var(--s600)', marginTop: '.25rem' }}>2.2. Depunere de acte</div>
          <CatalogFields catalog={CATALOG_22} stare={s.s22} onChange={s22 => patch({ s22 })} />
          <Check label={<><b>2.3.</b> Declarație pe propria răspundere cu privire la îndeplinirea condițiilor de funcționare</>}
            checked={s.s23} onChange={v => patch({ s23: v })} />
        </>
      ))}

      {are(3) && sec('p3', '3.', 'Operațiuni comunicate de autoritate/instituție publică', s.s3Autoritate || undefined, (
        <Field label="Autoritatea / instituția publică" value={s.s3Autoritate} onChange={v => patch({ s3Autoritate: v })} fieldRef={bindRef('s3-autoritate')} />
      ))}

      {are(4) && sec('p4', '4.', 'Radiere', undefined, (
        <div className="field">
          <label className="field-label">Motiv</label>
          <Chips<'DECES' | 'CERERE' | 'ART120'> fieldRef={bindRef('s4-motiv')} value={s.s4Motiv ? [s.s4Motiv] : []}
            onChange={v => patch({ s4Motiv: v[0] ?? '' })}
            options={[{ value: 'DECES', label: 'Deces' }, { value: 'CERERE', label: 'La cerere' }, { value: 'ART120', label: 'Art. 120 din Legea nr. 265/2022' }]} />
        </div>
      ))}

      {are(5) && sec('p5', '5.', 'Îndreptare eroare materială', s.s5.act || undefined, (
        <>
          <Field label="Referitoare la actul" value={s.s5.act} onChange={v => patch({ s5: { ...s.s5, act: v } })} fieldRef={bindRef('s5-act')} />
          <Field label="Pentru cererea/cererile nr./data" value={s.s5.cerere} onChange={v => patch({ s5: { ...s.s5, cerere: v } })} />
          <Chips<'INREGISTRARE' | 'MENTIUNE' | 'RADIERE'> multi value={s.s5.tipCerere} onChange={tipCerere => patch({ s5: { ...s.s5, tipCerere } })}
            options={[{ value: 'INREGISTRARE', label: 'Înregistrare' }, { value: 'MENTIUNE', label: 'Mențiune' }, { value: 'RADIERE', label: 'Radiere' }]} />
          <Field label="În loc de" value={s.s5.inLocDe} onChange={v => patch({ s5: { ...s.s5, inLocDe: v } })} />
          <Field label="Se va înregistra" value={s.s5.seVa} onChange={v => patch({ s5: { ...s.s5, seVa: v } })} fieldRef={bindRef('s5-seva')} />
        </>
      ))}

      {sec('vii', 'VII.', 'Obiectul de activitate', s.vii.moduri.length
        ? [s.vii.principal.cod, ...LISTE_CAEN.filter(x => listaCaenActiva(s, x.l)).map(x => `${x.label.toLowerCase()} ${claseCompletate(s.vii.liste[x.l]).length}`)].filter(Boolean).join(' · ')
        : 'nu se completează', (
        <>
          <div className="field">
            <label className="field-label">Se completează pentru</label>
            <Chips<ModVII> multi value={s.vii.moduri} onChange={moduri => setVii({ moduri })}
              options={[{ value: 'INREGISTRARE', label: 'Înregistrare' }, { value: 'MODIFICARE', label: 'Modificare' }, { value: 'ACTUALIZARE', label: 'Actualizare CAEN Rev. 3' }]} />
          </div>
          {s.vii.moduri.length === 0 ? (
            <div style={NOTE}>Nimic ales: tabelele rămân goale în document.</div>
          ) : (
            <>
              <SubTitle>1. Activitatea principală</SubTitle>
              <div style={ROW} ref={bindRef('vii-principal')}>
                <Field label="Clasa CAEN" flex={0} minWidth={90} value={s.vii.principal.cod} onChange={cod => setVii({ principal: { ...s.vii.principal, cod } })} />
                <Field label="Denumire" flex={3} value={s.vii.principal.den} onChange={den => setVii({ principal: { ...s.vii.principal, den } })} />
              </div>
              {doarActualizare ? (
                <div style={NOTE}>Nota 9: la actualizarea exclusivă potrivit CAEN Rev. 3 se completează doar activitatea principală.</div>
              ) : (
                <>
                  <SubTitle>2. Activități secundare</SubTitle>
                  {LISTE_CAEN.map(({ l, label }) => (
                    <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                      <Check label={`${label} (${CAEN_RANDURI[l]} rânduri)`} checked={s.vii.on[l]} onChange={v => setVii({ on: { ...s.vii.on, [l]: v } })} />
                      {s.vii.on[l] && <TabelCaen randuri={s.vii.liste[l]} onChange={r => setVii({ liste: { ...s.vii.liste, [l]: r } })} />}
                    </div>
                  ))}
                  <div style={NOTE}>Nota 8: dacă sunt mai multe activități decât rânduri, se completează o anexă. Precompletat din fișă: activitatea principală și cele secundare.</div>
                </>
              )}
            </>
          )}
        </>
      ))}

      {sec('viii', 'VIII.', 'Sedii secundare (puncte de lucru)', [s.viii.inf && 'înființare', s.viii.rad && 'radiere'].filter(Boolean).join(', ') || undefined, (
        <>
          <Check label="Înființare" checked={s.viii.inf} onChange={v => patch({ viii: { ...s.viii, inf: v } })} />
          {s.viii.inf && (
            <>
              <Field label="Adresa (localitate, județ/sector, stradă, număr, bloc, scară, etaj, apartament)" value={s.viii.infText} onChange={v => patch({ viii: { ...s.viii, infText: v } })} />
              {(client?.puncteLucru ?? []).filter(p => !s.viii.infText.includes(p)).map(p => (
                <button key={p} type="button" className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }}
                  onClick={() => patch({ viii: { ...s.viii, infText: [s.viii.infText.trim(), p].filter(Boolean).join('; ') } })}>+ {p}</button>
              ))}
            </>
          )}
          <Check label="Radiere" checked={s.viii.rad} onChange={v => patch({ viii: { ...s.viii, rad: v } })} />
          {s.viii.rad && <Field label="Adresa" value={s.viii.radText} onChange={v => patch({ viii: { ...s.viii, radText: v } })} />}
        </>
      ))}

      {sec('ix', 'IX.', 'Solicit', [s.ix.audienta && 'audiență', s.ix.copii && 'copii', s.ix.copiiCert && 'copii certificate', s.ix.comunicare && 'comunicare'].filter(Boolean).join(', ') || undefined, (
        <>
          <Check label="Audiență publică" checked={s.ix.audienta} onChange={v => patch({ ix: { ...s.ix, audienta: v } })} />
          <Check label="Copii" checked={s.ix.copii} onChange={v => patch({ ix: { ...s.ix, copii: v } })} />
          <Check label="Copii certificate de pe documentele" checked={s.ix.copiiCert} onChange={v => patch({ ix: { ...s.ix, copiiCert: v } })} />
          {s.ix.copiiCert && <Field label="Care documente" value={s.ix.copiiCertDoc} onChange={v => patch({ ix: { ...s.ix, copiiCertDoc: v } })} />}
          <Check label="Comunicarea documentelor care atestă înregistrarea, într-o singură modalitate" checked={s.ix.comunicare} onChange={v => patch({ ix: { ...s.ix, comunicare: v } })} />
          {s.ix.comunicare && (
            <>
              <Chips<'POSTA' | 'CURIER' | 'ELECTRONIC' | 'SEDIU_ORCT' | 'PRIMARIE'> fieldRef={bindRef('ix-modalitate')} value={s.ix.modalitate ? [s.ix.modalitate] : []}
                onChange={v => patch({ ix: { ...s.ix, modalitate: v[0] ?? '' } })}
                options={[{ value: 'POSTA', label: 'Poștă' }, { value: 'CURIER', label: 'Curier' }, { value: 'ELECTRONIC', label: 'Mijloace electronice' },
                  { value: 'SEDIU_ORCT', label: 'Sediul O.R.C.T.' }, { value: 'PRIMARIE', label: 'Biroul Primăriei' }]} />
              {s.ix.modalitate === 'SEDIU_ORCT' && <Field label="Sediul O.R.C.T." value={s.ix.sediuOrct} onChange={v => patch({ ix: { ...s.ix, sediuOrct: v } })} />}
              {s.ix.modalitate === 'PRIMARIE' && <Field label="Biroul de asistență și reprezentare al Primăriei" value={s.ix.primarie} onChange={v => patch({ ix: { ...s.ix, primarie: v } })} />}
            </>
          )}
        </>
      ))}

      {sec('x', 'X.', 'Persoana pentru comunicare', `${com.nume} ${com.prenume}`.trim() || undefined, (
        <ComunicareFields com={s.com} sub={s.sub} update={f => setS(prev => ({ ...prev, com: f(prev.com) }))} />
      ))}

      {sec('xi', 'XI.', 'Date de facturare', s.fact.sursa === 'niciuna' ? 'pe plătitor' : fact.nume || undefined, (
        <FacturareFields fact={s.fact} rezolvat={fact} update={f => setS(prev => ({ ...prev, fact: f(prev.fact) }))} nota="Nota 10" />
      ))}

      {sec('xii', 'XII.', 'Opis de documente depuse', (() => {
        const n = s.opis.filter((r, i) => (i < OPIS_TIPARITE.length ? r.nrData.trim() || r.file.trim() : r.den.trim())).length
        const t = totalFile(s.opis)
        return n ? `${n} documente${t ? ` · ${t} file` : ''}` : undefined
      })(), (
        <>
          <div style={NOTE}>Rândurile 1–7 au denumirea tipărită în formular; completează doar numărul/data și filele celor pe care le depui. Rândurile 8–11 sunt libere.</div>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {ACTE_OPIS.filter(a => !s.opis.some(r => r.den === a)).map(a => (
              <button key={a} type="button" className="btn btn-ghost btn-xs" onClick={() => adaugaInOpis(a)}>+ {a}</button>
            ))}
          </div>
          {s.opis.slice(0, OPIS_RANDURI_2B).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.4rem', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '.78rem', fontWeight: 700, width: '1.4rem', paddingBottom: '.45rem' }}>{i + 1}.</span>
              {i < OPIS_TIPARITE.length
                ? <div style={{ flex: 3, fontSize: '.78rem', color: 'var(--s700)', paddingBottom: '.45rem', minWidth: 0 }}>{OPIS_TIPARITE[i]}</div>
                : <Field label="Denumirea actului" flex={3} value={r.den} onChange={v => setOpisRand(i, { den: v })} />}
              <Field label="Nr. și data / emitent" flex={2} value={r.nrData} onChange={v => setOpisRand(i, { nrData: v })} />
              <Field label="File" flex={0} minWidth={60} value={r.file} onChange={v => setOpisRand(i, { file: v })} />
            </div>
          ))}
          <div style={NOTE}>Total file: {totalFile(s.opis) || '—'}.</div>
        </>
      ))}

      {sec('semnare', 'XIII–XV.', 'Semnare și depunere', s.dataSemnare ? `data ${s.dataSemnare}${s.dep.activ ? ' · depune altă persoană' : ''}` : undefined, (
        <>
          <div style={ROW}>
            <FieldDate label="Data (XIII și XIV)" value={s.dataSemnare} onChange={v => patch({ dataSemnare: v })} showToday />
            <Field label="Anexele nr. (XIV)" value={s.anexe} onChange={v => patch({ anexe: v })} placeholder="ex. 1, 2" />
          </div>
          <div style={NOTE}>La XIII apare numele subsemnatului ({numeSub || '—'}). Data goală rămâne de completat de mână.</div>
          <DeponentFields dep={s.dep} update={f => setS(prev => ({ ...prev, dep: f(prev.dep) }))} bindRef={bindRef}
            eticheta="XV. Cererea o depune altă persoană decât semnatarul (nota 13)" />
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

export default Anexa2bFiller

