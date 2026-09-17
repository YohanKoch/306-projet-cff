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

type MapStatus = 'loading' | 'ready' | 'error'

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

export function NetworkMap({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const mapSVGRef = useRef<Selection<SVGSVGElement, unknown, null, undefined> | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')

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
        host.replaceChildren(svg)
        fitViewBox(svg)

        const behaviour = zoom<SVGSVGElement, unknown>()
          .scaleExtent(SCALE_EXTENT)
          .on('zoom', (event) => {
            layer.setAttribute('transform', event.transform.toString())
          })
        mapSVGRef.current = select(svg)
        mapSVGRef.current.call(behaviour)

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
