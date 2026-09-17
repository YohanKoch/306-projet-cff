import { useState } from 'react'
import { NetworkMap, type MapSelection } from '@/components/network-map'
import { StationPanel } from '@/components/station-panel'
import { TrackPanel } from '@/components/track-panel'

function App() {
  const [selection, setSelection] = useState<MapSelection | null>(null)

  return (
    <div className="bg-background text-foreground flex h-svh">
      <NetworkMap selection={selection} onSelect={setSelection} className="flex-1" />

      {selection?.kind === 'station' && (
        <StationPanel
          key={selection.code}
          code={selection.code}
          onClose={() => setSelection(null)}
        />
      )}

      {selection?.kind === 'track' && (
        <TrackPanel
          selection={selection}
          onClose={() => setSelection(null)}
          onSelectStation={(code) => setSelection({ kind: 'station', code })}
        />
      )}
    </div>
  )
}

export default App
