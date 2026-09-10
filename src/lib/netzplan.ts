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
