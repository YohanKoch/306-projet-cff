/**
 * Récupère les données du plan de réseau grandes lignes depuis network.sbb.ch
 * et en extrait la partie utile à l'application.
 *
 *   node scripts/extract-netzplan.mjs
 *
 * Produit :
 *   public/map.svg          plan schématique (Illustrator, viewBox 0 0 4000 4000)
 *   src/data/netzplan.json  lignes + gares (~19 Ko, extrait des 22 Mo de la source)
 *
 * Le fichier source complet contient tous les horaires cadencés ; seul le bloc
 * `general` nous intéresse ici.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://network.sbb.ch/static'

async function download(path) {
  const response = await fetch(`${BASE}/${path}`)
  if (!response.ok) {
    throw new Error(`${BASE}/${path} : HTTP ${response.status}`)
  }
  return response
}

async function write(relativePath, contents) {
  const target = resolve(ROOT, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
  console.log(`${relativePath} — ${(Buffer.byteLength(contents) / 1024).toFixed(1)} Ko`)
}

const svg = await (await download('map.svg')).text()
await write('public/map.svg', svg)

const { general } = await (await download('netzplan.json')).json()

const netzplan = {
  source: `${BASE}/netzplan.json`,
  lines: general.all_lines.map((line) => ({
    code: line.code,
    label: line.label,
    color: line.color,
    stations: line.map_stations.split('-'),
    from: line.station_code_max_stretch_1,
    to: line.station_code_max_stretch_2,
  })),
  stations: general.all_stations.map((station) => ({
    code: station.code,
    label: station.label,
    uic: station.uic,
    relevance: station.relevance,
    labelSize: station.label_size,
  })),
}

await write('src/data/netzplan.json', `${JSON.stringify(netzplan, null, 2)}\n`)
console.log(`${netzplan.lines.length} lignes, ${netzplan.stations.length} gares`)
