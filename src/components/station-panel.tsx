import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { lines, stationsByCode } from '@/lib/netzplan'
import {
  fetchStationDetails,
  type AccessibilityStatus,
  type StationDetails,
} from '@/lib/sbb-open-data'

/** Code couleur de la conformité LHand, imposé par le cahier des charges. */
const ACCESSIBILITY_LABELS: Record<AccessibilityStatus, { label: string; colour: string }> = {
  compliant: { label: 'Conforme à la LHand', colour: 'bg-sbb-green' },
  partial: { label: 'Partiellement conforme', colour: 'bg-sbb-orange' },
  'non-compliant': { label: 'Non conforme à la LHand', colour: 'bg-sbb-red' },
  unknown: { label: 'Statut inconnu', colour: 'bg-sbb-sky' },
}

const numberFormat = new Intl.NumberFormat('fr-CH')

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

export function StationPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const station = stationsByCode.get(code)
  const [details, setDetails] = useState<StationDetails | null>(null)
  const [failed, setFailed] = useState(false)

  // Le panneau est monté par code de gare (`key` côté App), donc l'état part
  // toujours de zéro : pas de remise à zéro à faire ici.
  useEffect(() => {
    const controller = new AbortController()

    fetchStationDetails(code, controller.signal)
      .then(setDetails)
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        console.error(error)
        setFailed(true)
      })

    return () => controller.abort()
  }, [code])

  const served = lines.filter((line) => line.stations.includes(code))
  const accessibility = details && ACCESSIBILITY_LABELS[details.accessibility.status]

  return (
    <aside className="bg-card flex w-96 shrink-0 flex-col overflow-y-auto border-l">
      <header className="flex items-start justify-between gap-4 p-6 pb-4">
        <div>
          <h2 className="text-xl leading-tight font-bold">{station?.label ?? code}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {code}
            {station ? ` · UIC ${station.uic}` : null}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
          <X />
        </Button>
      </header>

      <Separator />

      <section className="space-y-3 p-6">
        <h3 className="text-sm font-bold">Fréquentation</h3>

        {failed && (
          <p className="text-destructive text-sm">
            Les données n’ont pas pu être chargées.
          </p>
        )}

        {!failed && !details && (
          <p className="text-muted-foreground text-sm">Chargement…</p>
        )}

        {details &&
          (details.frequency ? (
            <>
              <p className="text-3xl font-bold">
                {numberFormat.format(details.frequency.averageDaily)}
              </p>
              <p className="text-muted-foreground text-xs">
                voyageurs par jour en moyenne, {details.frequency.year}
              </p>

              <div className="space-y-1 pt-2">
                {details.frequency.workingDay !== null && (
                  <Figure
                    label="Jour ouvrable"
                    value={numberFormat.format(details.frequency.workingDay)}
                  />
                )}
                {details.frequency.nonWorkingDay !== null && (
                  <Figure
                    label="Jour non ouvrable"
                    value={numberFormat.format(details.frequency.nonWorkingDay)}
                  />
                )}
                {details.frequency.canton && (
                  <Figure label="Canton" value={details.frequency.canton} />
                )}
              </div>

              {details.frequency.note && (
                <p className="text-muted-foreground text-xs">{details.frequency.note}</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Aucune donnée de fréquentation pour cette gare.
            </p>
          ))}
      </section>

      <Separator />

      <section className="space-y-3 p-6">
        <h3 className="text-sm font-bold">Accessibilité</h3>

        {accessibility && details && (
          <>
            <span
              className={`${accessibility.colour} text-sbb-white inline-flex rounded-md px-3 py-1 text-sm font-bold`}
            >
              {accessibility.label}
            </span>

            {details.accessibility.total > 0 && (
              <div className="space-y-1 pt-1">
                <Figure
                  label="Bords de quai conformes"
                  value={`${details.accessibility.compliant} / ${details.accessibility.total}`}
                />
                <Figure
                  label="Partiellement conformes"
                  value={String(details.accessibility.partial)}
                />
                <Figure
                  label="Non conformes"
                  value={String(details.accessibility.nonCompliant)}
                />
              </div>
            )}
          </>
        )}

        {!details && !failed && <p className="text-muted-foreground text-sm">Chargement…</p>}
      </section>

      {served.length > 0 && (
        <>
          <Separator />
          <section className="space-y-3 p-6">
            <h3 className="text-sm font-bold">Lignes desservies</h3>
            <div className="flex flex-wrap gap-1.5">
              {served.map((line) => (
                <Badge
                  key={line.code}
                  className="text-sbb-white border-transparent"
                  style={{ backgroundColor: line.color }}
                >
                  {line.label}
                </Badge>
              ))}
            </div>
          </section>
        </>
      )}
    </aside>
  )
}
