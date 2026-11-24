import { describe, expect, it } from 'vitest'
import {
  ACCEPT, arbore, caleFolder, continutRecursiv, descendenti, extensie, familie, fisierDinFirestore, formatMarime, inaltime,
  previzualizabil, sorteazaFisiere, sorteazaFoldere, subfoldere, verificaLocal, type Fisier, type Folder,
  ascundeTemporar, ascunseAcum, extractibil, felPrevizualizare, normalizeazaCautare, numeLipire, reafiseaza,
} from './fisiere'

const folder = (id: string, parentId: string | null, nume = id): Folder => ({ id, clientId: 'c1', parentId, nume })
const fisier = (id: string, p: Partial<Fisier> = {}): Fisier => ({
  id, clientId: 'c1', folderId: null, nume: `${id}.pdf`, mime: 'application/pdf', marime: 100, sursa: 'incarcat',
  stare: 'acceptat', createdAt: new Date(2026, 0, 1), createdBy: 'u', arhivat: false, ...p,
})

// Acte › 2024 › Ian ; Acte › 2025 ; Contracte
const FOLDERE = [
  folder('acte', null, 'Acte'), folder('a24', 'acte', '2024'), folder('ian', 'a24', 'Ian'),
  folder('a25', 'acte', '2025'), folder('contr', null, 'contracte'),
]

describe('formatMarime', () => {
  it('folosește unitățile și virgula românească', () => {
    expect(formatMarime(512)).toBe('512 B')
    expect(formatMarime(12 * 1024)).toBe('12 KB')
    expect(formatMarime(1.45 * 1024 * 1024)).toBe('1,5 MB')
    expect(formatMarime(15 * 1024 * 1024)).toBe('15 MB')
    expect(formatMarime(10 * 1024 ** 3)).toBe('10 GB')
  })
})

describe('verificaLocal', () => {
  it('respinge fișierele goale, prea mari sau de tip necunoscut înainte de trimitere', () => {
    expect(verificaLocal({ name: 'a.pdf', size: 0 })).toMatch(/gol/)
    expect(verificaLocal({ name: 'a.pdf', size: 15 * 1024 * 1024 + 1 })).toMatch(/15 MB/)
    expect(verificaLocal({ name: 'setup.exe', size: 10 })).toMatch(/neacceptat/)
    expect(verificaLocal({ name: 'fara-extensie', size: 10 })).toMatch(/neacceptat/)
    expect(verificaLocal({ name: 'CI Ion.JPG', size: 10 })).toBeNull()
    expect(verificaLocal({ name: 'act.pdf.p7s', size: 10 })).toBeNull()
  })
  it('ACCEPT conține extensiile, cu punct', () => {
    expect(ACCEPT.split(',')).toContain('.heic')
    expect(ACCEPT.split(',').every(e => e.startsWith('.'))).toBe(true)
  })
})

describe('tipuri', () => {
  it('familia și previzualizarea după mime', () => {
    expect(familie('application/pdf')).toBe('pdf')
    expect(familie('image/heic')).toBe('imagine')
    expect(familie('application/x-necunoscut')).toBe('altul')
    expect(previzualizabil('image/png')).toBe(true)
    expect(previzualizabil('image/heic')).toBe(false)      // browserele (în afară de Safari) nu-l afișează
    expect(previzualizabil('application/msword')).toBe(false)
  })
  it('extensia', () => {
    expect(extensie('a.b.PDF')).toBe('pdf')
    expect(extensie('.bashrc')).toBe('')
    expect(extensie('fara')).toBe('')
  })
})

describe('foldere', () => {
  it('subfolderele, ordonate alfabetic (fără deosebire de majuscule)', () => {
    expect(subfoldere(FOLDERE, null).map(f => f.nume)).toEqual(['Acte', 'contracte'])
    expect(subfoldere(FOLDERE, 'acte').map(f => f.nume)).toEqual(['2024', '2025'])
  })
  it('calea de la rădăcină; un folder dispărut dă calea goală', () => {
    expect(caleFolder(FOLDERE, 'ian').map(f => f.nume)).toEqual(['Acte', '2024', 'Ian'])
    expect(caleFolder(FOLDERE, null)).toEqual([])
    expect(caleFolder(FOLDERE, 'sters')).toEqual([])
  })
  it('calea nu ciclează la date corupte', () => {
    const ciclu = [folder('x', 'y'), folder('y', 'x')]
    expect(caleFolder(ciclu, 'x').length).toBeLessThanOrEqual(7)
  })
  it('descendenții, înălțimea și arborele plat', () => {
    expect([...descendenti(FOLDERE, 'acte')].sort()).toEqual(['a24', 'a25', 'acte', 'ian'])
    expect(inaltime(FOLDERE, 'acte')).toBe(3)
    expect(inaltime(FOLDERE, 'contr')).toBe(1)
    expect(arbore(FOLDERE).map(o => `${o.nivel}:${o.folder.nume}`)).toEqual(['0:Acte', '1:2024', '2:Ian', '1:2025', '0:contracte'])
  })
  it('conținutul recursiv, pentru confirmarea ștergerii', () => {
    const fisiere = [fisier('f1', { folderId: 'ian' }), fisier('f2', { folderId: 'acte' }), fisier('f3', { folderId: 'contr' }), fisier('f4')]
    expect(continutRecursiv(FOLDERE, fisiere, 'acte')).toEqual({ fisiere: 2, foldere: 3 })
    expect(continutRecursiv(FOLDERE, fisiere, 'a25')).toEqual({ fisiere: 0, foldere: 0 })
  })
})

describe('sorteazaFisiere', () => {
  const lista = [
    fisier('b', { nume: 'act 10.pdf', marime: 5, createdAt: new Date(2026, 0, 2) }),
    fisier('a', { nume: 'Act 2.pdf', marime: 50, createdAt: new Date(2026, 0, 3) }),
    fisier('c', { nume: 'ștampilă.png', marime: 5, createdAt: null }),
  ]
  it('după nume, cu numere în ordine naturală', () => {
    expect(sorteazaFisiere(lista, 'nume').map(f => f.id)).toEqual(['a', 'b', 'c'])
  })
  it('după dată, cele mai noi primele', () => {
    expect(sorteazaFisiere(lista, 'data').map(f => f.id)).toEqual(['a', 'b', 'c'])
  })
  it('după mărime, cele mai mari primele', () => {
    expect(sorteazaFisiere(lista, 'marime').map(f => f.id)).toEqual(['a', 'b', 'c'])
  })
  it('după tip: PDF, imagini, Word…; la același tip, după nume', () => {
    const tipuri = [
      fisier('w', { nume: 'contract.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      fisier('i', { nume: 'poza.png', mime: 'image/png' }),
      fisier('p2', { nume: 'b.pdf' }), fisier('p1', { nume: 'a.pdf' }),
    ]
    expect(sorteazaFisiere(tipuri, 'tip').map(f => f.id)).toEqual(['p1', 'p2', 'i', 'w'])
    expect(sorteazaFisiere(tipuri, 'tip', true).map(f => f.id)).toEqual(['w', 'i', 'p1', 'p2'])
  })
  it('direcția se poate inversa; la egalitate rămâne ordinea după nume', () => {
    expect(sorteazaFisiere(lista, 'nume', true).map(f => f.id)).toEqual(['c', 'b', 'a'])
    expect(sorteazaFisiere(lista, 'marime', false).map(f => f.id)).toEqual(['b', 'c', 'a'])
  })
  it('nu modifică lista primită', () => {
    const copie = [...lista]
    sorteazaFisiere(lista, 'nume')
    expect(lista).toEqual(copie)
  })
})

describe('fisierDinFirestore', () => {
  it('completează valorile lipsă și recunoaște Arhiva', () => {
    const f = fisierDinFirestore('x', { nume: 'a.pdf', arhivat: true, clientId: null, clientNume: 'Alfa SRL', cale: 'Acte' })
    expect(f).toMatchObject({ id: 'x', clientId: null, folderId: null, marime: 0, sursa: 'incarcat', stare: 'acceptat', arhivat: true, clientNume: 'Alfa SRL' })
  })
})

describe('sorteazaFoldere', () => {
  const fisiere = [fisier('f1', { folderId: 'ian', marime: 900 }), fisier('f2', { folderId: 'contr', marime: 100 })]
  const radacina = subfoldere(FOLDERE, null)
  it('după mărime: totalul din folder și din subfoldere', () => {
    expect(sorteazaFoldere(radacina, FOLDERE, fisiere, 'marime').map(f => f.id)).toEqual(['acte', 'contr'])
    expect(sorteazaFoldere(radacina, FOLDERE, fisiere, 'marime', false).map(f => f.id)).toEqual(['contr', 'acte'])
  })
  it('după tip: folderele nu se deosebesc, deci rămân după nume', () => {
    expect(sorteazaFoldere(radacina, FOLDERE, fisiere, 'tip', true).map(f => f.nume)).toEqual(['Acte', 'contracte'])
  })
  it('după nume, descrescător', () => {
    expect(sorteazaFoldere(radacina, FOLDERE, fisiere, 'nume', true).map(f => f.nume)).toEqual(['contracte', 'Acte'])
  })
})

describe('căutare, lipire, previzualizare', () => {
  it('căutarea ignoră diacriticele, majusculele și spațiile de la capete', () => {
    expect(normalizeazaCautare('  CI Ștefănescu ')).toBe('ci stefanescu')
    expect(normalizeazaCautare('Ștefănescu').includes(normalizeazaCautare('stefan'))).toBe(true)
  })
  it('capturile lipite primesc un nume cu data; fișierele cu nume propriu și-l păstrează', () => {
    const acum = new Date(2026, 10, 24, 9, 5, 7)
    expect(numeLipire({ name: 'image.png', type: 'image/png' }, acum)).toBe('Captură 2026-11-24 09.05.07.png')
    expect(numeLipire({ name: '', type: 'image/jpeg' }, acum)).toBe('Captură 2026-11-24 09.05.07.jpg')
    expect(numeLipire({ name: 'CI Ion.pdf', type: 'application/pdf' }, acum)).toBe('CI Ion.pdf')
  })
  it('felul previzualizării și actele din care se pot extrage date', () => {
    expect(felPrevizualizare('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word')
    expect(felPrevizualizare('application/xml')).toBe('text')
    expect(felPrevizualizare('application/msword')).toBeNull()
    expect(previzualizabil('text/csv')).toBe(true)
    expect(extractibil('image/jpeg')).toBe(true)
    expect(extractibil('image/heic')).toBe(false)
  })
})

describe('ștergeri amânate', () => {
  it('elementele ascunse reapar la „Anulează”; fiecare schimbare e o mulțime nouă (React o observă)', () => {
    const inainte = ascunseAcum()
    ascundeTemporar(['a', 'b'])
    expect([...ascunseAcum()].sort()).toEqual(['a', 'b'])
    expect(ascunseAcum()).not.toBe(inainte)
    reafiseaza(['a'])
    expect([...ascunseAcum()]).toEqual(['b'])
    reafiseaza(['b'])
    expect(ascunseAcum().size).toBe(0)
  })
})
