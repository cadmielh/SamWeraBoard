// Câmpuri manuale scrise ca listă („operațiunea”, „lista actelor”) care se aleg din bife, nu se tastează: textul se
// compune din bife + „alte”, în ordinea listei („a, b și c”). Regulă generică, după numele câmpului, pentru orice șablon:
//  - {{CAMP_OPERATIUNE}} / {{CAMP_OPERATIUNI}} → operațiunile de la Registrul Comerțului;
//  - {{CAMP_LISTA_ACTELOR}} / {{CAMP_LISTA_ACTE}} → actele pe care cabinetul le poate genera (de bază + proprii), cu
//    aceeași denumire generică pentru variantele aceluiași act, bifate implicit cele generate recent pentru client.

export type FelLista = 'operatiune' | 'acte'

export function felLista(ph: string): FelLista | null {
  const inner = ph.replace(/^\{\{CAMP_|\}\}$/g, '')
  if (/^OPERATIUN[EI]$/.test(inner)) return 'operatiune'
  if (/^LISTA_ACTE(LOR)?$/.test(inner)) return 'acte'
  return null
}

export const OPERATIUNI = [
  'înființare societate', 'schimbare sediu social', 'schimbare denumire', 'cesiune părți sociale',
  'majorare capital social', 'reducere capital social', 'numire administrator', 'revocare administrator',
  'prelungire mandat administrator', 'modificare obiect de activitate (cod CAEN)', 'deschidere punct de lucru',
  'închidere punct de lucru', 'actualizare date asociați/administratori', 'prelungire durată societate',
  'suspendare activitate', 'dizolvare și lichidare voluntară',
]

/** „a”, „a și b”, „a, b și c”. */
export function joinSi(items: string[]): string {
  const xs = items.map(s => s.trim()).filter(Boolean)
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} și ${xs[xs.length - 1]}`
}

/** Textul: cele din listă în ordinea listei, apoi cele scrise de mână, în ordinea adăugării. */
export function textLista(optiuni: string[], alese: string[]): string {
  const set = new Set(alese)
  return joinSi([...optiuni.filter(o => set.has(o)), ...alese.filter(a => !optiuni.includes(a))])
}

const fara = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Denumirea generică a unui act după numele șablonului: variantele aceluiași act (de bază, copii, ale cabinetului)
 * ajung la aceeași denumire. Hotărârea/decizia urmează numărul de asociați ai clientului. Altfel, numele curățat. */
export function denumireAct(nume: string, asociatUnic: boolean, numeCabinet = ''): string {
  const n = fara(nume).replace(/_/g, ' ')
  if (/act(ul)? constitutiv/.test(n)) return 'actul constitutiv'
  if (/hotarar|decizi/.test(n)) return asociatUnic ? 'decizia asociatului unic' : 'hotărârea adunării generale a asociaților'
  if (/beneficiar/.test(n)) return 'declarația privind beneficiarii reali'
  if (/anexa ?1\b|inregistrare fiscala/.test(n)) return 'cererea de înregistrare fiscală'
  if (/anexa ?2|cerere(a)? (de )?inregistrare/.test(n)) return 'cererea de înregistrare la Registrul Comerțului'
  if (/declaratie.*(activitat|propria raspundere)/.test(n)) return 'declarația pe propria răspundere privind activitatea'
  if (/comodat/.test(n)) return /auto/.test(n) ? 'contractul de comodat pentru autoturism' : 'contractul de comodat pentru sediu'
  if (/cesiune.*parti sociale/.test(n)) return 'contractul de cesiune a părților sociale'
  if (/inchiriere/.test(n)) return 'contractul de închiriere'
  // Nume propriu: fără extensie, „MODEL”, numele cabinetului sau forma juridică
  let s = nume.replace(/\.docx?$/i, '').replace(/_/g, ' ').replace(/\bMODEL\b/gi, '')
  if (numeCabinet.trim()) s = s.replace(new RegExp(numeCabinet.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
  s = s.replace(/\b(S\.?R\.?L\.?|S\.?A\.?)(?=\s|$)/g, '').replace(/\s+/g, ' ').trim()
  return s ? s[0].toLowerCase() + s.slice(1) : nume
}

/** Actele distincte, în ordinea șabloanelor; fără documentul curent (contractul nu se listează pe el însuși). */
export function listaActe(nume: string[], asociatUnic: boolean, numeCabinet = ''): string[] {
  return [...new Set(nume.map(x => denumireAct(x, asociatUnic, numeCabinet)))]
}
