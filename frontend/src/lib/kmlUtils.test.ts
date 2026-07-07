import { describe, expect, it } from 'vitest'
import type { FeatureCollection, Point } from 'geojson'
import { parseKmlText } from './kmlUtils'

const KML_POINT = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test</name>
      <description>A point</description>
      <Point><coordinates>10,20,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`

const KML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document></Document>
</kml>`

describe('parseKmlText', () => {
    it('parses a KML Point into GeoJSON', () => {
        const result = parseKmlText(KML_POINT) as FeatureCollection
        expect(result.type).toBe('FeatureCollection')
        expect(result.features).toHaveLength(1)
        const point = result.features[0].geometry as Point
        expect(point.type).toBe('Point')
        expect(point.coordinates[0]).toBe(10)
        expect(point.coordinates[1]).toBe(20)
    })

    it('returns an empty FeatureCollection for an empty document', () => {
        const result = parseKmlText(KML_EMPTY) as FeatureCollection
        expect(result.type).toBe('FeatureCollection')
        expect(result.features).toEqual([])
    })

    it('does not throw on malformed XML', () => {
        // DOMParser returns a parsererror document rather than throwing.
        // The wrapper should still return something callable on the kml() output.
        expect(() => parseKmlText('not actually xml')).not.toThrow()
    })
})
