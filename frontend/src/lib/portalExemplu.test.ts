import { describe, expect, it, vi } from 'vitest'
import { anuleazaLipsa, citestePortal, incarcaAct, marcheazaLipsa, retrageFisier } from './portal'
import { TOKEN_EXEMPLU, linkExemplu, pornesteExemplu } from './portalExemplu'

describe('exemplul portalului', () => {
  it('nu atinge serverul: încărcare, retragere și „Nu am acest act” rămân în memorie', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    vi.useFakeTimers()
    pornesteExemplu('Cabinet Test', 'Ana Pop')
    const p = await citestePortal(TOKEN_EXEMPLU)
    expect(p.cabinet).toBe('Cabinet Test')
    expect(p.cerutDe).toBe('Ana Pop')
    const ci = p.acte[0]

    const progres: number[] = []
    const promis = incarcaAct(TOKEN_EXEMPLU, ci.id, new Blob(['x']), 'CI.jpg', v => progres.push(v), 'fata')
    await vi.runAllTimersAsync()
    const f = await promis
    expect(progres.at(-1)).toBe(1)
    let dupa = (await citestePortal(TOKEN_EXEMPLU)).acte[0]
    expect(dupa.stare).toBe('primit')
    expect(dupa.fisiere).toEqual([{ id: f!.id, nume: 'CI.jpg', marime: 1, parte: 'fata' }])
    // Ce a primit pagina e o copie: n-o poate schimba din greșeală.
    expect(ci.fisiere).toEqual([])

    await retrageFisier(TOKEN_EXEMPLU, f!.id)
    dupa = (await citestePortal(TOKEN_EXEMPLU)).acte[0]
    expect(dupa.stare).toBe('de_trimis')

    await marcheazaLipsa(TOKEN_EXEMPLU, p.acte[2].id, 'nu sunt căsătorit')
    expect((await citestePortal(TOKEN_EXEMPLU)).acte[2]).toMatchObject({ stare: 'lipsa', notaClient: 'nu sunt căsătorit' })
    await anuleazaLipsa(TOKEN_EXEMPLU, p.acte[2].id)
    expect((await citestePortal(TOKEN_EXEMPLU)).acte[2].stare).toBe('de_trimis')

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.useRealTimers()
    fetchSpy.mockRestore()
  })

  it('pornește curat la fiecare deschidere', async () => {
    pornesteExemplu('A', '')
    await marcheazaLipsa(TOKEN_EXEMPLU, 'a3', '')
    pornesteExemplu('A', '')
    expect((await citestePortal(TOKEN_EXEMPLU)).acte.every(a => a.stare === 'de_trimis')).toBe(true)
  })

  it('linkul poartă numele cabinetului și al celui care cere, dar nu o adresă de e-mail', () => {
    expect(linkExemplu('Cabinet & Co', 'Ana Pop')).toBe('/p/exemplu?cabinet=Cabinet+%26+Co&de=Ana+Pop')
    expect(linkExemplu('X', 'ana@x.ro')).toBe('/p/exemplu?cabinet=X')
    expect(linkExemplu('', '')).toBe('/p/exemplu')
  })
})
