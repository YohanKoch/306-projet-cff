/**
 * Accès aux jeux de données ouverts des CFF (portail Opendatasoft).
 *
 * Les deux jeux utilisés se joignent directement sur le code de gare du
 * netzplan : `code_codice` pour la fréquentation, `bps_abk` pour la BehiG.
 * 133 des 135 gares du plan y figurent ; manquent Annemasse et Konstanz,
 * hors de Suisse.
 */
const BASE = 'https://data.sbb.ch/api/explore/v2.1/catalog/datasets'

/** Fréquentation : une ligne par gare et par année. */
const FREQUENCY_DATASET = 'passagierfrequenz'

/** Conformité BehiG (LHand) : une ligne par bord de quai. */
const ACCESSIBILITY_DATASET = '21196_behig-haltekantepunkt'

/**
 * Classes de conformité relevées dans le jeu BehiG :
 *   18  quai P35 ou P55 sans défaut          accès autonome
 *   35  quai P35 ou P55, écart de 40 à 75 mm accès partiel
 *   02  quai bas (P20, P25, autre) ou défaut majeur
 */
const CONFORMITY_COMPLIANT = '18'
const CONFORMITY_PARTIAL = '35'

export interface StationFrequency {
  year: number
  averageDaily: number
  workingDay: number | null
  nonWorkingDay: number | null
  canton: string | null
  note: string | null
}

export type AccessibilityStatus = 'compliant' | 'partial' | 'non-compliant' | 'unknown'

export interface StationAccessibility {
  status: AccessibilityStatus
  compliant: number
  partial: number
  nonCompliant: number
  total: number
}

export interface StationDetails {
  frequency: StationFrequency | null
  accessibility: StationAccessibility
}

interface FrequencyRecord {
  jahr_annee_anno: number | null
  dtv_tjm_tgm: number | null
  dwv_tmjo_tfm: number | null
  dnwv_tmjno_tmgnl: number | null
  kt_ct_cantone: string | null
  remarques: string | null
}

interface ConformityRecord {
  konf: string | null
  n: number | null
}

/** Les codes viennent de notre propre référentiel, mais la requête est filtrée. */
function sanitise(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '')
}

async function query<T>(
  dataset: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T[]> {
  const url = new URL(`${BASE}/${dataset}/records`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`${dataset} : HTTP ${response.status}`)
  }

  const payload = (await response.json()) as { results?: T[] }
  return payload.results ?? []
}

/** Dernière année disponible pour la fréquentation d'une gare. */
async function fetchFrequency(
  code: string,
  signal?: AbortSignal,
): Promise<StationFrequency | null> {
  const [record] = await query<FrequencyRecord>(
    FREQUENCY_DATASET,
    {
      where: `code_codice = "${sanitise(code)}"`,
      order_by: 'jahr_annee_anno desc',
      limit: '1',
    },
    signal,
  )

  if (!record || record.jahr_annee_anno === null || record.dtv_tjm_tgm === null) {
    return null
  }

  return {
    year: record.jahr_annee_anno,
    averageDaily: record.dtv_tjm_tgm,
    workingDay: record.dwv_tmjo_tfm,
    nonWorkingDay: record.dnwv_tmjno_tmgnl,
    canton: record.kt_ct_cantone,
    note: record.remarques,
  }
}

/**
 * Une gare compte des dizaines de bords de quai, chacun avec son verdict.
 * Le statut retenu pour la gare est le suivant :
 *   tous les bords conformes      -> conforme
 *   au moins un bord conforme
 *     ou partiellement conforme   -> partiellement conforme
 *   aucun                         -> non conforme
 *   aucune donnée                 -> inconnu
 */
async function fetchAccessibility(
  code: string,
  signal?: AbortSignal,
): Promise<StationAccessibility> {
  const records = await query<ConformityRecord>(
    ACCESSIBILITY_DATASET,
    {
      where: `bps_abk = "${sanitise(code)}"`,
      group_by: 'konf',
      select: 'konf, count(*) as n',
      limit: '10',
    },
    signal,
  )

  let compliant = 0
  let partial = 0
  let nonCompliant = 0

  for (const record of records) {
    const count = record.n ?? 0
    if (record.konf === CONFORMITY_COMPLIANT) {
      compliant += count
    } else if (record.konf === CONFORMITY_PARTIAL) {
      partial += count
    } else {
      nonCompliant += count
    }
  }

  const total = compliant + partial + nonCompliant

  let status: AccessibilityStatus = 'unknown'
  if (total > 0) {
    if (compliant === total) {
      status = 'compliant'
    } else if (compliant + partial > 0) {
      status = 'partial'
    } else {
      status = 'non-compliant'
    }
  }

  return { status, compliant, partial, nonCompliant, total }
}

export async function fetchStationDetails(
  code: string,
  signal?: AbortSignal,
): Promise<StationDetails> {
  const [frequency, accessibility] = await Promise.all([
    fetchFrequency(code, signal),
    fetchAccessibility(code, signal),
  ])

  return { frequency, accessibility }
}
