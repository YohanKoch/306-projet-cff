import { useCallback, useEffect, useRef, useState } from 'react'
import { select, type Selection } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { Maximize, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { resolveStationCode, stationsByCode } from '@/lib/netzplan'

/** Plan schématique des grandes lignes, récupéré depuis network.sbb.ch. */
const MAP_URL = '/map.svg'
const SVG_NS = 'http://www.w3.org/2000/svg'
const SCALE_EXTENT: [number, number] = [1, 16]
const ZOOM_STEP = 1.4
/** Calque du contour suisse : sert de cadrage initial. */
const FRAME_SELECTOR = '#A_Schweiz'
const FRAME_MARGIN = 0.02
/** Épaisseur du tracé invisible qui reçoit les clics sur une voie. */
const HIT_STROKE_WIDTH = 14
/** Au-delà, le geste est un déplacement de la carte, pas un clic. */
const DRAG_TOLERANCE = 4
const SELECTION_RING_PADDING = 4

type MapStatus = 'loading' | 'ready' | 'error'

export type MapSelection =
  | { kind: 'station'; code: string }
  | { kind: 'line'; code: string }

/**
 * Déplace tout le contenu du SVG dans un groupe unique, sur lequel d3-zoom
 * applique sa transformation.
 */
function createZoomLayer(svg: SVGSVGElement): SVGGElement {
  const layer = svg.ownerDocument.createElementNS(SVG_NS, 'g')
  layer.setAttribute('data-zoom-layer', '')
  layer.append(...Array.from(svg.childNodes))
  svg.append(layer)
  return layer
}

/**
 * Le SVG des CFF nomme ses éléments de façon sémantique
 * (`station_icon_AA`, `station_label_AA`, `track_IR37_GKD_AA`). On transpose
 * ces identifiants en attributs `data-*` exploitables depuis React, et on
 * rapproche chaque gare de son libellé issu du netzplan.
 */
function annotate(svg: SVGSVGElement): void {
  for (const icon of svg.querySelectorAll('[id^="station_icon_"]')) {
    const code = icon.id.slice('station_icon_'.length)
    icon.setAttribute('data-station', code)

    const title = svg.ownerDocument.createElementNS(SVG_NS, 'title')
    title.textContent = stationsByCode.get(code)?.label ?? code
    icon.append(title)
  }

  for (const label of svg.querySelectorAll('[id^="station_label_"]')) {
    label.setAttribute('data-station', label.id.slice('station_label_'.length))
  }

  for (const badge of svg.querySelectorAll('[id^="line_label_"]')) {
    const [code] = badge.id.slice('line_label_'.length).split('_')
    if (code) {
      badge.setAttribute('data-line-label', code)
    }
  }

  for (const track of svg.querySelectorAll('[id^="track_"]')) {
    const [, line, from, to] = track.id.split('_')
    if (!line || !from || !to) {
      continue
    }
    track.setAttribute('data-line', line)
    track.setAttribute('data-from', resolveStationCode(from))
    track.setAttribute('data-to', resolveStationCode(to))
  }
}

/**
 * Les voies sont tracées avec un trait de 3 unités, trop fin pour être cliqué
 * confortablement. Chaque segment est doublé d'un clone transparent plus
 * épais, inséré avant les libellés et les gares pour ne pas leur voler le clic.
 *
 * Le clone est une copie de l'élément d'origine, car le plan mélange trois
 * formes : 120 `path`, 176 `line` et 10 `polyline`. Retirer `stroke` et
 * `stroke-width` du clone laisse hériter ceux du groupe.
 */
function createHitLayer(svg: SVGSVGElement): void {
  const hits = svg.ownerDocument.createElementNS(SVG_NS, 'g')
  hits.setAttribute('data-hit-layer', '')
  hits.setAttribute('fill', 'none')
  hits.setAttribute('stroke', 'transparent')
  hits.setAttribute('stroke-width', String(HIT_STROKE_WIDTH))
  hits.setAttribute('stroke-linecap', 'round')

  for (const track of svg.querySelectorAll('[data-line]')) {
    const hit = track.cloneNode(false) as Element
    hit.removeAttribute('id')
    hit.removeAttribute('stroke')
    hit.removeAttribute('stroke-width')
    hit.setAttribute('data-hit', '')
    hits.append(hit)
  }

  const labels = svg.querySelector('#line_labels')
  if (labels) {
    labels.before(hits)
  } else {
    svg.querySelector('[data-zoom-layer]')?.append(hits)
  }
}

/**
 * Le `viewBox` d'origine est un carré de 4000 unités dont la Suisse n'occupe
 * qu'une fraction. On recadre sur le contour du pays pour que le plan
 * remplisse le conteneur.
 */
function fitViewBox(svg: SVGSVGElement): void {
  const frame = svg.querySelector(FRAME_SELECTOR)
  if (!(frame instanceof SVGGraphicsElement)) {
    return
  }

  const { x, y, width, height } = frame.getBBox()
  if (width === 0 || height === 0) {
    return
  }

  const margin = Math.max(width, height) * FRAME_MARGIN
  svg.setAttribute(
    'viewBox',
    `${x - margin} ${y - margin} ${width + 2 * margin} ${height + 2 * margin}`,
  )
}

/** Toutes les lignes dont un tronçon touche cette gare, d'après le plan. */
function linesThroughStation(svg: SVGSVGElement, code: string): Set<string> {
  const codes = new Set<string>()
  for (const track of svg.querySelectorAll(`[data-from="${code}"], [data-to="${code}"]`)) {
    const line = track.getAttribute('data-line')
    if (line) {
      codes.add(line)
    }
  }
  return codes
}

function resolveSelection(target: Element): MapSelection | null {
  const station = target.closest('[data-station]')
  if (station) {
    const code = station.getAttribute('data-station')
    return code ? { kind: 'station', code } : null
  }

  // Les pastilles de ligne du plan sont cliquables au même titre que les voies.
  const badge = target.closest('[data-line-label]')
  if (badge) {
    const code = badge.getAttribute('data-line-label')
    return code ? { kind: 'line', code } : null
  }

  const track = target.closest('[data-line]')
  if (track) {
    const code = track.getAttribute('data-line')
    return code ? { kind: 'line', code } : null
  }

  return null
}

/**
 * Marque la sélection dans le SVG. Cliquer une voie retient la ligne entière,
 * cliquer une gare retient toutes les lignes qui la desservent ; `data-focused`
 * sur la racine fait passer les autres voies en gris (voir global.css).
 */
function applySelection(svg: SVGSVGElement, selection: MapSelection | null): void {
  for (const marked of svg.querySelectorAll('[data-selected]')) {
    marked.removeAttribute('data-selected')
  }
  svg.querySelector('[data-selection-ring]')?.remove()
  svg.removeAttribute('data-focused')

  if (!selection) {
    return
  }

  const highlighted =
    selection.kind === 'line'
      ? new Set([selection.code])
      : linesThroughStation(svg, selection.code)

  for (const code of highlighted) {
    const selector = `[data-line="${code}"], [data-line-label="${code}"]`
    for (const element of svg.querySelectorAll(selector)) {
      element.setAttribute('data-selected', '')
    }
  }

  if (highlighted.size > 0) {
    svg.setAttribute('data-focused', '')
  }

  if (selection.kind !== 'station') {
    return
  }

  for (const element of svg.querySelectorAll(`[data-station="${selection.code}"]`)) {
    element.setAttribute('data-selected', '')
  }

  const icon = svg.querySelector(`[id^="station_icon_"][data-station="${selection.code}"]`)
  if (!(icon instanceof SVGGraphicsElement)) {
    return
  }

  const box = icon.getBBox()
  const ring = svg.ownerDocument.createElementNS(SVG_NS, 'circle')
  ring.setAttribute('data-selection-ring', '')
  ring.setAttribute('cx', String(box.x + box.width / 2))
  ring.setAttribute('cy', String(box.y + box.height / 2))
  ring.setAttribute('r', String(Math.max(box.width, box.height) / 2 + SELECTION_RING_PADDING))
  ring.setAttribute('fill', 'none')
  ring.setAttribute('stroke-width', '2')
  ring.style.stroke = 'var(--sbb-red)'
  svg.querySelector('[data-zoom-layer]')?.append(ring)
}

export function NetworkMap({
  selection,
  onSelect,
  className,
}: {
  selection: MapSelection | null
  onSelect: (selection: MapSelection | null) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const mapSVGRef = useRef<Selection<SVGSVGElement, unknown, null, undefined> | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const onSelectRef = useRef(onSelect)
  const [status, setStatus] = useState<MapStatus>('loading')

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const controller = new AbortController()

    fetch(MAP_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${MAP_URL} : HTTP ${response.status}`)
        }
        return response.text()
      })
      .then((source) => {
        const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
        const root = parsed.querySelector('svg')
        if (!root || parsed.querySelector('parsererror')) {
          throw new Error(`${MAP_URL} : SVG illisible`)
        }

        const svg = document.importNode(root, true)
        svg.removeAttribute('width')
        svg.removeAttribute('height')
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')

        const layer = createZoomLayer(svg)
        annotate(svg)
        createHitLayer(svg)
        host.replaceChildren(svg)
        fitViewBox(svg)

        const behaviour = zoom<SVGSVGElement, unknown>()
          .scaleExtent(SCALE_EXTENT)
          .on('zoom', (event) => {
            layer.setAttribute('transform', event.transform.toString())
          })
        mapSVGRef.current = select(svg)
        mapSVGRef.current.call(behaviour)

        let pressedAt: { x: number; y: number } | null = null

        svg.addEventListener('pointerdown', (event) => {
          pressedAt = { x: event.clientX, y: event.clientY }
        })

        svg.addEventListener('click', (event) => {
          const origin = pressedAt
          pressedAt = null
          if (origin) {
            const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y)
            if (moved > DRAG_TOLERANCE) {
              return
            }
          }

          const target = event.target
          if (target instanceof Element) {
            onSelectRef.current(resolveSelection(target))
          }
        })

        svgRef.current = svg
        zoomRef.current = behaviour
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        console.error(error)
        setStatus('error')
      })

    return () => {
      controller.abort()
      host.replaceChildren()
      svgRef.current = null
      mapSVGRef.current = null
      zoomRef.current = null
    }
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (svg && status === 'ready') {
      applySelection(svg, selection)
    }
  }, [selection, status])

  const scaleBy = useCallback((factor: number) => {
    const mapSVG = mapSVGRef.current
    const behaviour = zoomRef.current
    if (mapSVG && behaviour) {
      behaviour.scaleBy(mapSVG, factor)
    }
  }, [])

  const resetZoom = useCallback(() => {
    const mapSVG = mapSVGRef.current
    const behaviour = zoomRef.current
    if (mapSVG && behaviour) {
      behaviour.transform(mapSVG, zoomIdentity)
    }
  }, [])

  return (
    <div className={cn('bg-background relative size-full overflow-hidden', className)}>
      <div
        ref={hostRef}
        className="size-full [&_svg]:size-full [&_svg]:cursor-grab [&_svg]:touch-none [&_svg]:select-none [&_svg:active]:cursor-grabbing"
      />

      {status === 'loading' && (
        <p className="text-muted-foreground absolute inset-0 grid place-content-center text-sm">
          Chargement du plan de réseau…
        </p>
      )}

      {status === 'error' && (
        <p className="text-destructive absolute inset-0 grid place-content-center text-sm">
          Le plan de réseau n’a pas pu être chargé.
        </p>
      )}

      {status === 'ready' && (
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <Button variant="secondary" size="icon" onClick={() => scaleBy(ZOOM_STEP)} aria-label="Zoomer">
            <Plus />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => scaleBy(1 / ZOOM_STEP)} aria-label="Dézoomer">
            <Minus />
          </Button>
          <Button variant="secondary" size="icon" onClick={resetZoom} aria-label="Vue d’ensemble">
            <Maximize />
          </Button>
        </div>
      )}
    </div>
  )
}
