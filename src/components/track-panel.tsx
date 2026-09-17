import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { linesByCode, stationsByCode } from '@/lib/netzplan'
import type { MapSelection } from '@/components/network-map'

type TrackSelection = Extract<MapSelection, { kind: 'track' }>

function label(code: string): string {
  return stationsByCode.get(code)?.label ?? code
}

export function TrackPanel({
  selection,
  onClose,
  onSelectStation,
}: {
  selection: TrackSelection
  onClose: () => void
  onSelectStation: (code: string) => void
}) {
  const line = linesByCode.get(selection.line)
  const shared = selection.lines.filter((code) => code !== selection.line)
  const endpoints = new Set([selection.from, selection.to])

  return (
    <aside className="bg-card flex w-96 shrink-0 flex-col overflow-y-auto border-l">
      <header className="flex items-start justify-between gap-4 p-6 pb-4">
        <div className="space-y-2">
          <Badge
            className="text-sbb-white border-transparent text-sm"
            style={{ backgroundColor: line?.color }}
          >
            {line?.label ?? selection.line}
          </Badge>
          <h2 className="text-xl leading-tight font-bold">
            {label(selection.from)} – {label(selection.to)}
          </h2>
          {line && (
            <p className="text-muted-foreground text-xs">
              Ligne {label(line.from)} – {label(line.to)}, {line.stations.length} gares
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X />
        </Button>
      </header>

      <Separator />

      <section className="space-y-3 p-6">
        <h3 className="text-sm font-bold">Tronçon</h3>
        <p className="text-muted-foreground text-sm">
          Section entre {label(selection.from)} et {label(selection.to)}, telle que
          tracée sur le plan de réseau.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[selection.from, selection.to].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onSelectStation(code)}
              className="hover:bg-accent rounded-md border px-3 py-1 text-sm"
            >
              {label(code)}
            </button>
          ))}
        </div>
      </section>

      <Separator />

      <section className="space-y-3 p-6">
        <h3 className="text-sm font-bold">Lignes empruntant ce tronçon</h3>
        {shared.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {shared.map((code) => (
              <Badge
                key={code}
                className="text-sbb-white border-transparent"
                style={{ backgroundColor: linesByCode.get(code)?.color }}
              >
                {linesByCode.get(code)?.label ?? code}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Aucune autre ligne n’emprunte ce tronçon.
          </p>
        )}
      </section>

      {line && (
        <>
          <Separator />
          <section className="space-y-3 p-6">
            <h3 className="text-sm font-bold">Parcours de la ligne</h3>
            <ol className="space-y-1">
              {line.stations.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => onSelectStation(code)}
                    className={`hover:text-foreground w-full text-left text-sm ${
                      endpoints.has(code) ? 'text-foreground font-bold' : 'text-muted-foreground'
                    }`}
                  >
                    {label(code)}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </aside>
  )
}
