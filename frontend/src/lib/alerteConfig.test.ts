import { describe, it, expect } from 'vitest'
import {
  normalizeazaPraguri, tipuriPentruRol, preferintaEfectiva, sursaEfectiva, curataPreferinte, areModificari,
  descrierePraguri, zileText,
} from './alerteConfig'
import { MAX_RESPONSABILI, PREFERINTE_IMPLICITE, TIP_ALERTA, type PreferinteAlerte } from './alerteCatalog'

const prefs = (over: Partial<PreferinteAlerte> = {}): PreferinteAlerte => ({ ...PREFERINTE_IMPLICITE, ...over })
const fara = prefs()

describe('normalizeazaPraguri', () => {
  it('întregi unici, în limite, descrescător, cel mult 5', () => {
    expect(normalizeazaPraguri('termen', [7, 30, 7, 90.6, -3, 400])).toEqual([365, 90, 30, 7, 0])
    expect(normalizeazaPraguri('termen', [1, 2, 3, 4, 5, 6, 7])).toEqual([7, 6, 5, 4, 3])
  })

  it('„vechime” pornește de la 1 zi; „termen” acceptă 0 (azi)', () => {
    expect(normalizeazaPraguri('vechime', [0, 14])).toEqual([14, 1])
    expect(normalizeazaPraguri('termen', [0])).toEqual([0])
  })

  it('valorile care nu sunt numere se ignoră; tipurile fără praguri au listă goală', () => {
    expect(normalizeazaPraguri('termen', ['7', null, NaN, Infinity, 3])).toEqual([3])
    expect(normalizeazaPraguri('termen', 'x')).toEqual([])
    expect(normalizeazaPraguri('imediat', [3])).toEqual([])
    expect(normalizeazaPraguri('eveniment', [3])).toEqual([])
  })
})

describe('tipuriPentruRol', () => {
  it('abonamentul doar la admini; „acces doar în citire” la toți', () => {
    const coduri = (r: Parameters<typeof tipuriPentruRol>[0]) => tipuriPentruRol(r).map(t => t.cod)
    expect(coduri('admin')).toContain('trial_expira')
    expect(coduri('member')).not.toContain('plata_esuata')
    expect(coduri('viewer')).toContain('acces_citire')
    expect(coduri(null)).toEqual([])
  })
})

describe('preferintaEfectiva', () => {
  it('implicitele rolului: tipurile de client pornite la admin, oprite la membru', () => {
    const t = TIP_ALERTA.mandat_expira
    expect(preferintaEfectiva(t, fara, 'admin')).toEqual({ activ: true, praguri: [90, 30, 7], obligatoriu: false, modificat: false })
    expect(preferintaEfectiva(t, fara, 'member')).toEqual({ activ: false, praguri: [90, 30, 7], obligatoriu: false, modificat: false })
    expect(preferintaEfectiva(TIP_ALERTA.dosar_blocat, fara, 'member').activ).toBe(true)
    expect(preferintaEfectiva(TIP_ALERTA.dosar_blocat, fara, 'viewer').activ).toBe(false)
  })

  it('alegerea salvată se aplică și marchează tipul ca modificat', () => {
    const p = prefs({ tipuri: { mandat_expira: { activ: true } } })
    expect(preferintaEfectiva(TIP_ALERTA.mandat_expira, p, 'member')).toMatchObject({ activ: true, modificat: true })
    // La admin, „pornit” e chiar implicitul.
    expect(preferintaEfectiva(TIP_ALERTA.mandat_expira, p, 'admin').modificat).toBe(false)
  })

  it('obligatoriu: rămâne pornit orice s-ar fi salvat', () => {
    const p = prefs({ tipuri: { acces_citire: { activ: false }, trial_expira: { activ: false } } })
    expect(preferintaEfectiva(TIP_ALERTA.acces_citire, p, 'viewer')).toEqual({ activ: true, praguri: [], obligatoriu: true, modificat: false })
    expect(preferintaEfectiva(TIP_ALERTA.trial_expira, p, 'admin')).toMatchObject({ activ: true, obligatoriu: true })
  })

  it('pragurile salvate se curăță; lista goală sau greșită revine la catalog', () => {
    const t = TIP_ALERTA.ci_expira
    expect(preferintaEfectiva(t, prefs({ tipuri: { ci_expira: { praguri: [10, 10, 999] } } }), 'admin'))
      .toMatchObject({ praguri: [365, 10], modificat: true })
    expect(preferintaEfectiva(t, prefs({ tipuri: { ci_expira: { praguri: [] } } }), 'admin').praguri).toEqual([60, 30])
    expect(preferintaEfectiva(t, prefs({ tipuri: { ci_expira: { praguri: [30, 60] } } }), 'admin').modificat).toBe(false)
  })
})

describe('sursaEfectiva', () => {
  it('implicitul pe rol: adminul de la toți, membrul doar ale lui', () => {
    expect(sursaEfectiva('dosare', fara, 'admin')).toEqual({ sursa: 'toate', responsabili: [] })
    expect(sursaEfectiva('sarcini', fara, 'member')).toEqual({ sursa: 'ale_mele', responsabili: [] })
  })

  it('alegerea salvată, cu lista de colegi curățată și limitată', () => {
    const multi = Array.from({ length: MAX_RESPONSABILI + 10 }, (_, i) => `u${i}`)
    const s = sursaEfectiva('dosare', prefs({ surse: { dosare: { sursa: 'responsabili', responsabili: ['u0', 'u0', '', ...multi] } } }), 'admin')
    expect(s.sursa).toBe('responsabili')
    expect(s.responsabili).toHaveLength(MAX_RESPONSABILI)
    expect(s.responsabili[0]).toBe('u0')
  })
})

describe('curataPreferinte', () => {
  it('păstrează doar ce diferă de implicitele rolului', () => {
    const p = prefs({
      tipuri: {
        mandat_expira: { activ: true, praguri: [7, 30, 90] }, // la admin: identic cu implicitul
        ci_expira: { activ: false, praguri: [60, 30] },       // doar oprirea contează
        dosar_blocat: { praguri: [21] },
        nu_exista: { activ: false },
        acces_citire: { activ: false },                       // obligatoriu: nu se poate opri
        plata_esuata: {},
      },
      surse: { dosare: { sursa: 'toate', responsabili: ['x'] }, sarcini: { sursa: 'ale_mele', responsabili: [] } },
      ignorate: ['client:c1', 'client:c1'],
    })
    expect(curataPreferinte(p, 'admin')).toEqual({
      tipuri: { ci_expira: { activ: false }, dosar_blocat: { praguri: [21] } },
      surse: { sarcini: { sursa: 'ale_mele', responsabili: [] } },
      ignorate: ['client:c1'],
    })
  })

  it('aceeași alegere e diferență la un rol și implicit la altul', () => {
    const p = prefs({ tipuri: { mandat_expira: { activ: true } }, surse: { dosare: { sursa: 'ale_mele', responsabili: [] } } })
    expect(curataPreferinte(p, 'member')).toEqual({
      tipuri: { mandat_expira: { activ: true } }, surse: {}, ignorate: [],
    })
    expect(curataPreferinte(p, 'admin')).toEqual({
      tipuri: {}, surse: { dosare: { sursa: 'ale_mele', responsabili: [] } }, ignorate: [],
    })
  })

  it('tipurile pe care rolul nu le poate primi se elimină; „anumiți colegi” se păstrează mereu', () => {
    const p = prefs({
      tipuri: { trial_expira: { praguri: [10] } },
      surse: { sarcini: { sursa: 'responsabili', responsabili: [] } },
    })
    expect(curataPreferinte(p, 'member')).toEqual({ tipuri: {}, surse: { sarcini: { sursa: 'responsabili', responsabili: [] } }, ignorate: [] })
    expect(curataPreferinte(p, 'admin').tipuri).toEqual({ trial_expira: { praguri: [10] } })
  })

  it('areModificari: ignorările nu contează', () => {
    expect(areModificari(prefs({ ignorate: ['client:c1'] }), 'admin')).toBe(false)
    expect(areModificari(prefs({ tipuri: { mandat_expira: { activ: true } } }), 'admin')).toBe(false)
    expect(areModificari(prefs({ tipuri: { mandat_expira: { activ: true } } }), 'member')).toBe(true)
  })
})

describe('descrierePraguri', () => {
  it('termen', () => {
    expect(descrierePraguri({ fel: 'termen' }, [90, 30, 7])).toBe('90, 30 și 7 zile înainte')
    expect(descrierePraguri({ fel: 'termen' }, [90, 30])).toBe('90 și 30 de zile înainte')
    expect(descrierePraguri({ fel: 'termen' }, [3, 1, 0])).toBe('3 zile și 1 zi înainte, apoi în ziua termenului')
    expect(descrierePraguri({ fel: 'termen' }, [7, 3, 1])).toBe('7, 3 zile și 1 zi înainte')
    expect(descrierePraguri({ fel: 'termen' }, [0])).toBe('în ziua termenului')
    expect(descrierePraguri({ fel: 'termen' }, [1])).toBe('1 zi înainte')
  })

  it('vechime, imediat, eveniment', () => {
    expect(descrierePraguri({ fel: 'vechime' }, [14])).toBe('după 14 zile')
    expect(descrierePraguri({ fel: 'vechime' }, [30, 7])).toBe('după 7 și 30 de zile')
    expect(descrierePraguri({ fel: 'imediat' }, [])).toBe('imediat')
    expect(descrierePraguri({ fel: 'eveniment' }, [])).toBe('la eveniment')
  })

  it('zileText', () => {
    expect(zileText(1)).toBe('o zi')
    expect(zileText(7)).toBe('7 zile')
    expect(zileText(20)).toBe('20 de zile')
    expect(zileText(101)).toBe('101 zile')
  })
})
