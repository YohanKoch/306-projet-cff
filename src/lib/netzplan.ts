import netzplan from '@/data/netzplan.json'

/** Une ligne grandes lignes du plan de réseau (IC1, IR37, RE33, ...). */
export interface NetzplanLine {
  code: string
  label: string
  /** Couleur officielle CFF de la ligne, telle qu'utilisée sur le plan. */
  color: string
  /** Codes des gares desservies, dans l'ordre du plan. */
  stations: string[]
  from: string
  to: string
}

export interface NetzplanStation {
  code: string
  label: string
  /** Code UIC, clé de rapprochement avec les données temps réel. */
  uic: number
  relevance: number
  labelSize: string
}

export const lines: NetzplanLine[] = netzplan.lines
export const stations: NetzplanStation[] = netzplan.stations

export const linesByCode = new Map(lines.map((line) => [line.code, line]))
export const stationsByCode = new Map(stations.map((station) => [station.code, station]))

/**
 * Certains identifiants du SVG portent un suffixe numérique absent du
 * référentiel (`track_IR37_AA_LB1` pour la gare `LB`).
 */
export function resolveStationCode(code: string): string {
  if (stationsByCode.has(code)) {
    return code
  }
  const trimmed = code.replace(/\d+$/, '')
  return stationsByCode.has(trimmed) ? trimmed : code
}

/** Les tronçons d'une ligne, chaque paire de gares triée pour être comparable. */
function segmentKeys(line: NetzplanLine): string[] {
  const keys: string[] = []
  for (let index = 1; index < line.stations.length; index += 1) {
    keys.push([line.stations[index - 1], line.stations[index]].sort().join('-'))
  }
  return keys
}

/**
 * Lignes partageant au moins un tronçon avec celle-ci. Les 304 paires de
 * gares du netzplan correspondent toutes à un segment du plan, la
 * comparaison est donc fidèle au tracé.
 */
export function linesSharingTrack(code: string): NetzplanLine[] {
  const line = linesByCode.get(code)
  if (!line) {
    return []
  }

  const segments = new Set(segmentKeys(line))
  return lines.filter(
    (other) => other.code !== code && segmentKeys(other).some((key) => segments.has(key)),
  )
}
