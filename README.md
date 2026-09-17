# 306-projet-cff

A real-time tracking interface for Swiss long-distance trains, drawn on
the official SBB schematic network plan.

The client asked for the look of the SBB network map[1] combined with
the live behaviour demonstrated on Trafimage[2]: watching trains move
along the network, highlighting one line at a time, and opening a
station to read its average daily passenger count and its accessibility
status.

## Stack

- React 19 with TypeScript, bundled by Vite 8
- Tailwind CSS 4, configured entirely from `src/global.css`
- shadcn/ui components, vendored under `src/components/ui`
- SBB design tokens mapped onto the shadcn tokens
- d3-zoom for panning and zooming the inline SVG
- oxlint for linting

### Why there is no mapping library

The reference plan is not a geographic map. It is a fixed-coordinate
schematic, closer to an underground map than to a slippy map: a single
SVG with a `viewBox` of 4000 units, no projection, no tiles, no
latitude or longitude anywhere.

MapLibre, Leaflet and OpenLayers all start from a Mercator frame. Using
one here would mean inventing fake geographic coordinates for a drawing
that has none. The plan is therefore rendered as plain inline SVG, and
`d3-zoom` only supplies the pan and zoom transform.

The consequence is spelled out under "Placing a train on the plan": the
live feed speaks in real coordinates, the plan does not, so positions
are matched through the timetable rather than projected.

## Getting started

```sh
npm install
npm run dev      # development server, http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint
npm run preview  # serve the production build
```

To refresh the SBB plan and its data:

```sh
node scripts/extract-netzplan.mjs
```

## Project layout

```
public/
  map.svg                    SBB schematic plan, 672 KB, served as-is
scripts/
  extract-netzplan.mjs       downloads and trims the SBB source data
src/
  App.tsx                    application shell
  global.css                 Tailwind entry and SBB design tokens
  components/
    network-map.tsx          the plan: loading, framing, zoom, clicks
    line-panel.tsx           line details, read locally
    station-panel.tsx        station details, fetched on selection
    ui/                      shadcn/ui components
  data/
    netzplan.json            34 lines and 135 stations, 28 KB
  lib/
    netzplan.ts              typed access and lookups
    sbb-open-data.ts         SBB open data portal client
    utils.ts                 shadcn `cn` helper
```

## The network plan

### Where the data comes from

`network.sbb.ch` serves two static assets. `map.svg` is an Illustrator
export of the printed plan. `netzplan.json` is a 22 MB file holding the
entire cadenced timetable, of which only the `general` block is useful
here.

`scripts/extract-netzplan.mjs` downloads both and writes
`src/data/netzplan.json`, 28 KB, holding:

- 34 lines: code, label, official colour, ordered station sequence
- 135 stations: code, label, UIC number, prominence on the plan

The UIC number matters beyond the plan: it is the join key against
every other Swiss railway dataset.

### How it is rendered

`src/components/network-map.tsx` fetches `/map.svg` at runtime rather
than importing it, so the plan stays out of the JavaScript bundle and
is cached by the browser on its own. The parsed document is imported
into the page, and all of its children are moved into a single group
that carries the zoom transform.

The original `viewBox` is a square in which Switzerland covers barely a
third of the surface, the rest being empty sea. The component reframes
the view on the `#A_Schweiz` layer, measured with `getBBox()` once the
SVG is in the document, so the plan fills its container.

### What the SVG exposes

The SBB drawing uses semantic identifiers, which the component turns
into `data-*` attributes so that React code never has to parse an `id`:

| Selector                   | Count | Meaning                      |
| -------------------------- | ----- | ---------------------------- |
| `[data-line]`              | 306   | line code of a track segment |
| `[data-from]`, `[data-to]` | 306   | endpoints of that segment    |
| `[data-station]`           | 305   | station code, icons and text |

So `track_IR37_GKD_AA` becomes a path carrying `data-line="IR37"`,
`data-from="GKD"` and `data-to="AA"`. Each station icon also receives a
`<title>` holding the name read from the netzplan, which the browser
shows as a tooltip.

Two further layers are worth knowing about, both unused so far:
`#highlight_wrapper`, which SBB clearly intended for line highlighting,
and `#inactive_x5F_line_x5F_path`.

Station codes in the SVG almost always match the reference data. The
one exception, `track_IR37_AA_LB1`, is normalised by
`resolveStationCode()` in `src/lib/netzplan.ts`.

## Clicking the plan

Clicking a station, a track or a line badge opens a panel beside the
map. Clicking anywhere else closes it. The selection is a single piece
of state in `App.tsx`, shaped as a discriminated union:

```ts
type MapSelection =
  | { kind: 'station'; code: string }
  | { kind: 'line'; code: string }
```

Clicking a track selects the whole line it belongs to, not the segment
under the pointer. Clicking a station selects every line calling there.
Either way the outcome is a set of line codes, which drives the
highlight described below.

### Catching the click

One delegated listener sits on the SVG root and walks up from the event
target: `closest('[data-station]')` first, then `closest('[data-line-label]')`
for the line badges printed on the plan, then `closest('[data-line]')`.
Station icons and labels are painted above the tracks, so a station
always wins over the segment running underneath it.

Tracks are drawn with a 3 unit stroke, too thin to click comfortably.
Each segment is therefore doubled by a transparent clone with a 14 unit
stroke, gathered in a hit layer inserted just before the line labels, so
the fat targets never steal a click from a station. The clone is a copy
of the original element rather than a rebuilt path, because the plan
mixes three shapes: 120 `path`, 176 `line` and 10 `polyline`.

Panning also fires a click, so the pointer is tracked between
`pointerdown` and `click`, and a gesture that travelled more than 4
pixels is dropped.

### Highlighting the selection

Every track and badge belonging to a selected line is marked with
`data-selected`, and the SVG root gets `data-focused`. Two CSS rules do
the rest: tracks that are not selected turn grey, and badges that are
not selected fade. The hit layer is excluded from both, since its clones
must stay transparent.

Selecting Zürich HB, for instance, keeps 162 of the 306 segments in
colour, one for each of the 18 lines calling there, and greys the other
144.

A selected station also gets a red ring appended to the zoom layer, so
it pans and zooms with the plan, and its label turns bold.

### Station details

`src/lib/sbb-open-data.ts` queries the SBB open data portal[4] on
selection, both datasets in parallel, aborted if the selection changes
before they answer. 133 of the 135 stations on the plan are covered;
the two missing ones, Annemasse and Konstanz, are outside Switzerland.

The average daily passenger count comes from the `passagierfrequenz`
dataset. Its `code_codice` field carries exactly the same station codes
as the netzplan, so the join needs no mapping table, and the query keeps
the most recent year available. Working-day and non-working-day averages
come with it.

Accessibility under the LHand comes from the BehiG platform-edge
dataset, `21196_behig-haltekantepunkt`, roughly 496,000 rows keyed by
station abbreviation in `bps_abk`. The verdict sits in `konf`, which
holds three values:

| `konf` | Meaning                                       |
| ------ | --------------------------------------------- |
| `18`   | P35 or P55 platform, no defect                |
| `35`   | P35 or P55 platform, 40 to 75 mm gap          |
| `02`   | low platform, or a major defect               |

A station has one verdict per platform edge, so a station-level status
is derived from them: every edge compliant gives compliant, at least one
compliant or partial gives partially compliant, none gives not
compliant, and no rows at all gives unknown. The query groups and counts
server-side, so the browser never pulls the rows themselves.

The `dashboard_behig_tu` dataset on the same portal would have given a
ready-made per-station verdict, but it is currently empty.

### Line details

The line panel reads no API. Everything it shows already sits in
`src/data/netzplan.json`: the line with its official colour, its
terminuses and its full run. The lines sharing track with it are found
by comparing consecutive station pairs, which is faithful to the drawing
because all 304 pairs in the netzplan exist as a segment on the plan.

Stations listed in the panel are clickable and switch the selection over
to the station panel.

## Styling

`src/global.css` carries the whole SBB visual identity, taken from the
official Lyne design tokens[3]:

- the raw palette, exposed both as `--sbb-*` variables and as Tailwind
  utilities such as `bg-sbb-red` or `text-sbb-sky`
- the shadcn tokens remapped onto it, in light and dark mode, so every
  shadcn component inherits the SBB look without being patched
- SBB Web typography, its line heights and its heading scale
- the SBB focus ring: a thin outline offset by 3px, replacing the
  default shadcn halo

The SBB Web font is loaded from the official SBB CDN and is licensed
for SBB projects only. Removing the three `@font-face` rules falls back
to Helvetica Neue and Arial.

## Planned features

The feature below is designed but not yet implemented.

### Live trains

The feed behind Trafimage is the geOps Realtime API, a WebSocket on
`wss://api.geops.io/tracker-ws/v1/ws`, wrapped by
`mobility-toolbox-js`[5]. It needs an API key, which is still to be
sorted out. Two alternatives exist: the GTFS-RT feeds published on
opentransportdata.swiss, and the `ist-daten-sbb` dataset on the SBB
portal, which compares scheduled and actual times for the previous day
and is useful for offline development.

#### Placing a train on the plan

The feed reports geographic positions; the plan has no geography. The
link is made through the timetable instead:

1. The feed gives a vehicle, its line, and the stop sequence of its
   journey with scheduled and estimated times.
2. From that sequence, take the stop it last left, call it A, the stop
   it is heading for, B, and a progress ratio between the two, read
   off the clock.
3. The plan holds a path for that leg, reachable as
   `[data-line="IC1"][data-from="A"][data-to="B"]`.
4. `getTotalLength()` and `getPointAtLength()` return the exact point
   in SVG user units. The marker is appended to the zoom layer, so it
   pans and zooms with the plan for free.
5. When the segment is stored in the opposite direction, the ratio is
   inverted.
6. A train whose leg has no matching segment is dropped. The plan only
   carries the long-distance network.

#### Colour coding

Delays, per the brief:

| Delay          | Colour | Token          |
| -------------- | ------ | -------------- |
| 0 to 3 minutes | green  | `--sbb-green`  |
| 3 to 5 minutes | orange | `--sbb-orange` |
| over 5 minutes | red    | `--sbb-red`    |
| cancelled      | grey   | `--sbb-smoke`  |
| no live data   | blue   | `--sbb-sky`    |

Accessibility, per the brief:

| Status              | Colour | Token          |
| ------------------- | ------ | -------------- |
| fully compliant     | green  | `--sbb-green`  |
| partially compliant | orange | `--sbb-orange` |
| not compliant       | red    | `--sbb-red`    |
| unknown             | blue   | `--sbb-sky`    |

## Status

| Feature                 | State                          |
| ----------------------- | ------------------------------ |
| SBB styling             | done                           |
| Network plan, pan, zoom | done                           |
| Station details         | done                           |
| Line details            | done                           |
| Line highlighting       | done                           |
| Live trains             | designed, API key outstanding  |

[1]: https://network.sbb.ch/fr/
[2]: https://maps.trafimage.ch/ch.sbb.netzkarte
[3]: https://www.npmjs.com/package/@sbb-esta/lyne-design-tokens
[4]: https://data.sbb.ch/api/explore/v2.1/catalog/datasets
[5]: https://mobility-toolbox-js.geops.io/
