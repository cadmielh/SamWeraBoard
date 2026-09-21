import type { Client, Persoana, ScannedPerson } from '../types'
import type { IDFields } from './api'
import { resolvePersons } from './placeholders'
import { personSex, sexFromCnp, type Sex } from './sex'

/** Contextul trimis serverului ca să aleagă automat variantele „numit/ă”, „asociat unic/asociați”, „social/profesional”
 * (vezi variants.py). Cheile din `sex` sunt prefixele etichetelor persoanei (ASOCIAT_1, ADMINISTRATOR_NOU, DECLARANT);
 * cheia goală „” e persoana singulară a documentului ({{NUME}}, {{CNP}}). `null` = sex necunoscut: serverul nu ghicește. */
export interface VariantContext {
  sex: Record<string, Sex | null>
  asociati: number
  administratori: number
  tip: 'PJ' | 'PF' | null
}

const normName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

interface Options {
  client?: Partial<Client> | null
  scannedPersons?: ScannedPerson[]
  idFields?: IDFields | null
  /** Valorile finale ale etichetelor ({{CAMP}} → text), inclusiv cele din clauze/declarație. */
  replacements: Record<string, string>
}

export function buildVariantContext({ client, scannedPersons, idFields, replacements }: Options): { ctx: VariantContext; labels: Record<string, string> } {
  const sex: Record<string, Sex | null> = {}
  const labels: Record<string, string> = {}
  const nameIndex = new Map<string, Sex | null>()
  const nameOf = (p: Partial<Persoana>) => `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()
  const remember = (p: Persoana) => {
    const n = nameOf(p)
    if (!n) return
    const s = personSex(p)
    nameIndex.set(normName(n), s)
    nameIndex.set(normName(`${p.prenume ?? ''} ${p.nume ?? ''}`), s)
  }

  const isPF = client?.tipClient === 'PF'
  const asociati = isPF ? [] : resolvePersons(client, scannedPersons, 'asociat')
  const administratori = isPF ? [] : resolvePersons(client, scannedPersons, 'administrator')
  asociati.forEach((p, i) => { sex[`ASOCIAT_${i + 1}`] = personSex(p); labels[`ASOCIAT_${i + 1}`] = nameOf(p) || `asociatul ${i + 1}`; remember(p) })
  administratori.forEach((p, i) => { sex[`ADMINISTRATOR_${i + 1}`] = personSex(p); labels[`ADMINISTRATOR_${i + 1}`] = nameOf(p) || `administratorul ${i + 1}`; remember(p) })
  ;(client?.membriIF ?? []).forEach((p, i) => { sex[`MEMBRU_IF_${i + 1}`] = personSex(p); labels[`MEMBRU_IF_${i + 1}`] = nameOf(p) || `membrul ${i + 1}`; remember(p) })

  // Persoana singulară a documentului: scanarea curentă sau titularul unui client PF
  if (idFields) {
    sex[''] = sexFromCnp(idFields.cnp)
    labels[''] = `${idFields.nume ?? ''} ${idFields.prenume ?? ''}`.trim() || 'persoana din act'
  } else if (isPF && client?.titular) {
    sex[''] = personSex(client.titular)
    labels[''] = nameOf(client.titular) || 'titularul'
    remember(client.titular)
  }

  // Persoane referite doar prin etichete proprii (declarant, administrator nou/vechi, asociat care aportează…):
  // sexul vine din CNP-ul lor, dacă e completat, altfel din potrivirea numelui cu o persoană cunoscută a clientului.
  for (const key of Object.keys(replacements)) {
    const m = key.match(/^\{\{([A-Z0-9_]+)_NUME\}\}$/)
    if (!m || m[1] in sex) continue
    const prefix = m[1]
    const full = `${replacements[key] ?? ''} ${replacements[`{{${prefix}_PRENUME}}`] ?? ''}`.trim()
    sex[prefix] = sexFromCnp(replacements[`{{${prefix}_CNP}}`]) ?? nameIndex.get(normName(full)) ?? null
    labels[prefix] = full || prefix
  }

  const tip = client?.tipClient === 'PF' ? 'PF' : client?.tipClient === 'PJ' ? 'PJ' : null
  return { ctx: { sex, asociati: asociati.length, administratori: administratori.length, tip }, labels }
}

/** Mesajul afișat după generare, dacă serverul n-a putut stabili sexul unor persoane (alternativele au rămas în document). */
export function variantWarningMessage(refs: string[] | undefined, labels: Record<string, string>): string | null {
  if (!refs || refs.length === 0) return null
  const names = refs.map(r => labels[r] || r).join(', ')
  return `Sexul nu a putut fi stabilit pentru: ${names}. În document au rămas ambele variante (ex. „numit/ă”). Alege „Sex” în fișa persoanei și generează din nou.`
}
