import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { linesByCode, linesSharingTrack, stationsByCode } from '@/lib/netzplan'

function label(code: string): string {
  return stationsByCode.get(code)?.label ?? code
}

export function LinePanel({
  code,
  onClose,
  onSelectStation,
}: {
  code: string
  onClose: () => void
  onSelectStation: (station: string) => void
}) {
  const line = linesByCode.get(code)
  const shared = linesSharingTrack(code)

  return (
    <aside className="bg-card flex w-96 shrink-0 flex-col overflow-y-auto border-l">
      <header className="flex items-start justify-between gap-4 p-6 pb-4">
        <div className="space-y-2">
          <Badge
            className="text-sbb-white border-transparent text-sm"
            style={{ backgroundColor: line?.color }}
          >
            {line?.label ?? code}
          </Badge>
          {line && (
            <>
              <h2 className="text-xl leading-tight font-bold">
                {label(line.from)} – {label(line.to)}
              </h2>
              <p className="text-muted-foreground text-xs">
                {line.stations.length} gares desservies
              </p>
            </>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X />
        </Button>
      </header>

      <Separator />

      <section className="space-y-3 p-6">
        <h3 className="text-sm font-bold">Lignes partageant un tronçon</h3>
        {shared.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {shared.map((other) => (
              <Badge
                key={other.code}
                className="text-sbb-white border-transparent"
                style={{ backgroundColor: other.color }}
              >
                {other.label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Cette ligne ne partage aucun tronçon.
          </p>
        )}
      </section>

      {line && (
        <>
          <Separator />
          <section className="space-y-3 p-6">
            <h3 className="text-sm font-bold">Parcours</h3>
            <ol className="space-y-1">
              {line.stations.map((station) => (
                <li key={station}>
                  <button
                    type="button"
                    onClick={() => onSelectStation(station)}
                    className="text-muted-foreground hover:text-foreground w-full text-left text-sm"
                  >
                    {label(station)}
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
