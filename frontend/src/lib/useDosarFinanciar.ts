import { resolveFacturareConfig } from '../types'
import { calculDosarFinanciar, type DosarFinanciarInput } from './dosareStats'
import { useApp } from '../AppContext'

/** Calculul financiar (cuvenit Sami/Adi, CAA, impozit, profit) pentru un dosar
 * sau un formular de dosar — folosit identic în DosarView.tsx (dosar salvat)
 * și DosarModal.tsx (form în curs de completare), ca să nu se dubleze logica
 * de rezolvare a config-ului + formula de procent. */
export function useDosarFinanciar(d: DosarFinanciarInput) {
  const { activeWorkspace } = useApp()
  const facturareConfig = resolveFacturareConfig(activeWorkspace?.facturareConfig)
  const financiar = calculDosarFinanciar(d, facturareConfig)
  const cotaSami = d.esteClientAdi ? facturareConfig.cotaSamiClientiAdi : facturareConfig.cotaSamiClientiProprii
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
  return { facturareConfig, financiar, cotaSami, pct }
}
