import { describe, it, expect, vi, beforeAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import LandingPage from './LandingPage'
import { SettingsProvider } from '../SettingsContext'
import { PROVIDER } from '../lib/legalConfig'

// Comutatorul de temă folosește localStorage și matchMedia (mediul de test e „node”, fără browser).
beforeAll(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) })
})

const html = () => renderToStaticMarkup(<SettingsProvider><MemoryRouter><LandingPage onSignIn={async () => {}} /></MemoryRouter></SettingsProvider>)
const text = () => html().replace(/<[^>]+>/g, ' ')

describe('LandingPage', () => {
  it('prezintă brandul, prețul de pornire și accesul pe invitație', () => {
    const t = text()
    expect(t).toContain('Cabin')
    expect(t).toContain('de la 200 RON')
    expect(t).toContain('31 decembrie 2026')
    expect(t).toContain('pe invitație')
    expect(html()).toContain(`mailto:${PROVIDER.contactEmail}`)
  })

  it('nu conține numele fostului brand și nici formulări de conformitate absolută', () => {
    const t = text().toLowerCase()
    expect(t).not.toContain('samwera')
    expect(t).not.toContain('conform gdpr')
    expect(t).not.toContain('garant')
  })

  it('afirmă doar ce e verificat și declară serviciile globale', () => {
    const t = text()
    expect(t).toContain('Frankfurt')
    expect(t).toContain('servicii globale')
    expect(t).toContain('Aplicația nu oferă furnizorului acces')   // formularea nuanțată, nu „nu avem acces”
    expect(t).not.toMatch(/nu avem acces|nu vedem datele/i)
  })

  it('leagă documentele legale și datele furnizorului în subsol', () => {
    const h = html()
    for (const to of ['/termeni', '/confidentialitate', '/dpa', '/sub-imputerniciti', '/securitate']) {
      expect(h).toContain(`href="${to}"`)
    }
    expect(text()).toContain(PROVIDER.legalName)
  })

  it('are pictograme (SVG) pentru pași, funcții și securitate, ascunse cititoarelor de ecran', () => {
    const h = html()
    expect((h.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(45)
    expect(h).toContain('aria-hidden="true"')
  })

  it('conținutul e în pagină fără JavaScript (animațiile de apariție se activează doar din efect)', () => {
    expect(html()).not.toContain('lp-anim')          // clasa care ascunde elementele până la scroll se adaugă doar în browser
    expect(text()).toContain('De la act la dosar depus')
  })

  it('are comutator pentru modul întunecat, ca în aplicație, și butoane de autentificare cu contur vizibil', () => {
    const h = html()
    expect(h).toContain('theme-toggle-switch')
    expect(h).toContain('role="switch"')
    expect((h.match(/lp-outline/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('prezintă gestiunea clienților, dosarele, sarcinile și documentele, cu ilustrații decorative', () => {
    const h = html()
    const t = text()
    for (const id of ['clienti', 'dosare', 'sarcini', 'documente', 'pret', 'securitate']) expect(h).toContain(`id="${id}"`)
    expect(t).toContain('Gestiunea clienților')
    expect(t).toContain('Documentele se completează singure')
    expect((h.match(/class="lp-mock /g) ?? []).length).toBe(4)          // câte una pentru clienți, dosare, sarcini, documente
    expect(h).toContain('href="#clienti"')                              // navigare cu ancore
  })

  it('folosește în ilustrații doar date fictive și stadii/coloane existente în aplicație', () => {
    const t = text()
    for (const label of ['În lucru', 'Depus, în soluționare', 'Dosar eliberat', 'Deschis', 'Finalizat']) expect(t).toContain(label)
    expect(t).not.toMatch(/Sami|Adi\b|Wera/)                            // nimic din datele primului client
  })
})
