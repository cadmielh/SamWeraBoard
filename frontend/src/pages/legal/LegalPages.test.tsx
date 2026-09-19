import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { providerName } from '../../lib/legalConfig'

// Textele legale trebuie să fie generice și gata de citit: fără paranteze de completat, fără nume de cabinete.
const PAGES = ['TermeniPage', 'ConfidentialitatePage', 'DpaPage', 'SubImputernicitiPage', 'SecuritatePage'] as const

async function render(name: (typeof PAGES)[number]): Promise<string> {
  const mod = await import('./LegalPages')
  const Page = mod[name]
  return renderToStaticMarkup(<MemoryRouter><Page /></MemoryRouter>)
}

describe('pagini legale (configurarea curentă din lib/legalConfig.ts)', () => {
  it.each(PAGES)('%s nu conține paranteze sau texte de completat', async name => {
    const html = await render(name)
    const text = html.replace(/<[^>]+>/g, ' ')
    expect(text).not.toMatch(/\[[^\]]*\]/)                       // niciun „[...]”
    expect(text.toLowerCase()).not.toContain('de completat')
    expect(text.toLowerCase()).not.toContain('proiect')            // nu mai sunt marcate ca ciornă
    expect(text.toLowerCase()).not.toContain('draft')
    expect(text).toContain(providerName())                          // furnizorul (din configurare) apare în text
  })

  it.each(PAGES)('%s nu depinde de un cabinet anume (nume, CUI etc.)', async name => {
    const text = (await render(name)).replace(/<[^>]+>/g, ' ')
    expect(text).not.toMatch(/Cabinet\s+(Contabil|de)\s+[A-ZĂÂÎȘȚ]/)
    expect(text).not.toMatch(/\bRO\d{6,}\b/)
  })

  it('DPA: cabinetul apare ca „Operatorul”, indiferent care este', async () => {
    const text = (await render('DpaPage')).replace(/<[^>]+>/g, ' ')
    expect(text).toContain('Operatorul')
    expect(text).toContain('48 de ore')
    expect(text).toContain('30 de zile')
  })

  it('sub-împuterniciți: locațiile sunt precizate (UE), nu „de confirmat”', async () => {
    const text = (await render('SubImputernicitiPage')).replace(/<[^>]+>/g, ' ')
    expect(text).toContain('europe-west3')
    expect(text).toContain('Sweden Central')
    expect(text.toLowerCase()).not.toContain('de confirmat')
  })

  it('securitate: arată locația datelor în UE și cadrul legal, fără să pretindă certificări proprii', async () => {
    const text = (await render('SecuritatePage')).replace(/<[^>]+>/g, ' ')
    for (const must of ['europe-west3', 'Sweden Central', 'Legea nr. 190/2018', 'art. 28', 'art. 32', 'art. 33', 'AES-256-GCM', 'Cloud KMS', '48 de ore']) {
      expect(text).toContain(must)
    }
    expect(text).toContain('nu deține, la această dată, certificări independente proprii')
    expect(text).toContain('Acces minim la Google Drive')
    expect(text).toContain('drive.file')
    expect(text).toContain('tokenul Google rămâne în browser')
    expect(text).toContain('Procedură scrisă de răspuns la incidente')
    expect(text).toContain('limitarea cererilor pe utilizator și pe spațiu de lucru')
    expect(text.toLowerCase()).not.toContain('certificat iso')
    expect(text.toLowerCase()).not.toContain('100%')
  })

  it('OCR: spune corect că Azure păstrează și fișierul trimis (max. 24 h) și că cerem ștergerea imediată', async () => {
    for (const name of ['SecuritatePage', 'SubImputernicitiPage'] as const) {
      const text = (await render(name)).replace(/<[^>]+>/g, ' ')
      expect(text).toContain('24 de ore')
      expect(text).toContain('ștergerea')
    }
    const sec = (await render('SecuritatePage')).replace(/<[^>]+>/g, ' ')
    expect(sec).toContain('fișierul trimis și rezultatul analizei')          // nu doar „rezultatul”
    expect(sec).toContain('aplicația cere ștergerea lor imediat după procesare')
    expect(sec).toContain('nu le folosește pentru antrenarea modelelor')
  })

  it('confidențialitate: declară jurnalele tehnice (IP), contoarele de limitare și cookie-urile Google', async () => {
    const text = (await render('ConfidentialitatePage')).replace(/<[^>]+>/g, ' ')
    expect(text).toContain('Jurnale tehnice ale infrastructurii')
    expect(text).toContain('Frankfurt')
    expect(text).toContain('Contoare de limitare a cererilor')
    expect(text).toContain('Google poate seta propriile cookie-uri')
  })

  it('sub-împuterniciți: jurnalele tehnice sunt în UE, doar cele de administrare rămân „global”; termenii menționează Drive', async () => {
    const sub = (await render('SubImputernicitiPage')).replace(/<[^>]+>/g, ' ')
    expect(sub).toContain('Google Cloud Logging')
    expect(sub).toContain('europe-west3')
    expect(sub).toContain('locația „global”')
    const terms = (await render('TermeniPage')).replace(/<[^>]+>/g, ' ')
    expect(terms).toContain('funcțiile Google Drive')
    expect(terms).toContain('doar la fișierul pe care îl alegeți')
  })

  it('sub-împuterniciți: nu ascunde ce nu e în UE (CDN și autentificare)', async () => {
    const text = (await render('SubImputernicitiPage')).replace(/<[^>]+>/g, ' ')
    expect(text).toContain('Firebase Hosting')
    expect(text).toContain('Rețea globală')
    expect(text).toContain('Firebase Authentication')
    expect(text).toContain('cuiscan.ro')                            // interogat de aplicație: declarat, cu ce primește
    expect(text).toContain('doar codul de identificare fiscală (CIF)')
  })

  it('securitate: copiile/recuperarea bazei de date sunt descrise exact (7 zile), iar DPA e coerent', async () => {
    const sec = (await render('SecuritatePage')).replace(/<[^>]+>/g, ' ')
    const dpa = (await render('DpaPage')).replace(/<[^>]+>/g, ' ')
    expect(sec).toContain('ultimele 7 zile')
    expect(dpa).toContain('7 zile')
    expect(dpa).toContain('35 de zile')
  })

  it('cu contact necompletat: omite câmpurile goale și trimite spre datele de la finalul paginii', async () => {
    vi.resetModules()
    vi.doMock('../../lib/legalConfig', async () => {
      const real = await vi.importActual<typeof import('../../lib/legalConfig')>('../../lib/legalConfig')
      const PROVIDER = { ...real.PROVIDER, registration: '', address: '', contactEmail: '', securityEmail: '' }
      return { ...real, PROVIDER, contactEmail: () => '', securityEmail: () => '' }
    })
    const html = await render('ConfidentialitatePage')
    expect(html).not.toContain('Contact:')
    expect(html).not.toContain('Sediu:')
    expect(html.replace(/<[^>]+>/g, ' ')).toContain('datele de contact de la finalul acestei pagini')
    vi.doUnmock('../../lib/legalConfig')
    vi.resetModules()
  })

  it('cu configurarea curentă: contactul furnizorului apare în pagini', async () => {
    vi.resetModules()
    const { PROVIDER } = await import('../../lib/legalConfig')
    for (const name of PAGES) {
      const text = (await render(name)).replace(/<[^>]+>/g, ' ')
      if (PROVIDER.contactEmail) expect(text).toContain(PROVIDER.contactEmail)
      if (PROVIDER.registration) expect(text).toContain(PROVIDER.registration)
    }
  })
})

describe('pagini legale (configurare completată o singură dată)', () => {
  beforeEach(() => { vi.resetModules() })

  it('afișează identitatea furnizorului și adresa de contact în toate paginile', async () => {
    vi.doMock('../../lib/legalConfig', async () => {
      const real = await vi.importActual<typeof import('../../lib/legalConfig')>('../../lib/legalConfig')
      const PROVIDER = { ...real.PROVIDER, legalName: 'EXEMPLU SRL', registration: 'RO1234', address: 'Str. Test 1, București', contactEmail: 'contact@exemplu.ro', securityEmail: '' }
      return { ...real, PROVIDER, providerName: () => 'EXEMPLU SRL', contactEmail: () => 'contact@exemplu.ro', securityEmail: () => 'contact@exemplu.ro' }
    })
    for (const name of PAGES) {
      const text = (await render(name)).replace(/<[^>]+>/g, ' ')
      expect(text).toContain('EXEMPLU SRL')
      expect(text).toContain('contact@exemplu.ro')
      expect(text).toContain('Str. Test 1')
    }
    vi.doUnmock('../../lib/legalConfig')
  })
})
