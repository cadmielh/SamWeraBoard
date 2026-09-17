/** Registry central de feature flags per workspace. O particularitate nouă
 * pentru un client se adaugă o singură dată aici (cheie + etichetă) — pagina
 * de super admin generează automat comutatorul corespunzător, fără alte
 * modificări de infrastructură. */
export type FeatureKey = 'facturareSamiAdi'

export interface FeatureDef {
  key: FeatureKey
  label: string
  description: string
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  {
    key: 'facturareSamiAdi',
    label: 'Facturare Sami/Adi',
    description: 'Split financiar pe dosar (Cuvenit Sami/Adi, CAA, impozit, sumar lunar) — specific cabinetului Sami & Adi.',
  },
]

export function hasFeature(features: Partial<Record<FeatureKey, boolean>> | undefined | null, key: FeatureKey): boolean {
  return features?.[key] === true
}
