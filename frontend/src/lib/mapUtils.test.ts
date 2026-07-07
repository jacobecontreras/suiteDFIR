import { describe, expect, it, vi } from 'vitest'
import type { Feature } from 'geojson'
import { onEachFeature } from './mapUtils'

interface MockLayer {
    bindPopup: ReturnType<typeof vi.fn>
}

function makeLayer(): MockLayer {
    return { bindPopup: vi.fn() }
}

function popupHtml(layer: MockLayer): string {
    const call = layer.bindPopup.mock.calls[0]
    return call?.[0] ?? ''
}

function featureWith(properties: Record<string, unknown> | null): Feature {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: properties as Feature['properties'],
    }
}

describe('onEachFeature', () => {
    it('does nothing when feature.properties is missing', () => {
        const layer = makeLayer()
        onEachFeature(featureWith(null), layer as unknown as L.Layer)
        expect(layer.bindPopup).not.toHaveBeenCalled()
    })

    it('renders a popup with the artifact name', () => {
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'My Point', description: 'Just a note' }),
            layer as unknown as L.Layer,
        )
        const html = popupHtml(layer)
        expect(html).toContain('My Point')
    })

    it('defaults artifact name to "Artifact" when none is supplied', () => {
        const layer = makeLayer()
        onEachFeature(featureWith({ foo: 'bar' }), layer as unknown as L.Layer)
        expect(popupHtml(layer)).toContain('Artifact')
    })

    it('parses HTML table rows into key/value metadata', () => {
        const description = `<table>
            <tr><td>Latitude:</td><td>37.7749</td></tr>
            <tr><td>Longitude:</td><td>-122.4194</td></tr>
        </table>`
        const layer = makeLayer()
        onEachFeature(featureWith({ name: 'Pin', description }), layer as unknown as L.Layer)
        const html = popupHtml(layer)
        expect(html).toContain('Latitude')
        expect(html).toContain('37.7749')
        expect(html).toContain('Longitude')
        expect(html).toContain('-122.4194')
    })

    it('elevates an "Artifact" row from the table to the heading', () => {
        const description = `<table><tr><td>Artifact</td><td>Photo EXIF</td></tr></table>`
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'fallback name', description }),
            layer as unknown as L.Layer,
        )
        const html = popupHtml(layer)
        expect(html).toContain('Photo EXIF')
    })

    it('parses dash-delimited string descriptions', () => {
        const description = 'Timestamp: 2024-01-01T00:00:00Z - Source: WiFi - Category: Network'
        const layer = makeLayer()
        onEachFeature(featureWith({ name: 'X', description }), layer as unknown as L.Layer)
        const html = popupHtml(layer)
        expect(html).toContain('Source')
        expect(html).toContain('WiFi')
        expect(html).toContain('Category')
        expect(html).toContain('Network')
    })

    it('beautifies snake_case extra properties', () => {
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'p', horizontal_accuracy: '5m' }),
            layer as unknown as L.Layer,
        )
        expect(popupHtml(layer)).toContain('Horizontal Accuracy')
    })

    it('skips null/undefined/empty extra properties', () => {
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'p', empty_field: '', null_field: null, missing: undefined }),
            layer as unknown as L.Layer,
        )
        const html = popupHtml(layer)
        expect(html).not.toContain('Empty Field')
        expect(html).not.toContain('Null Field')
        expect(html).not.toContain('Missing')
    })

    it('omits internal keys like styleUrl', () => {
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'p', styleUrl: '#x', styleHash: 'abc' }),
            layer as unknown as L.Layer,
        )
        const html = popupHtml(layer)
        expect(html).not.toContain('StyleUrl')
        expect(html).not.toContain('StyleHash')
    })

    it('formats values whose key includes "time" as locale dates', () => {
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'p', start_time: '2024-01-15T12:34:56Z' }),
            layer as unknown as L.Layer,
        )
        const html = popupHtml(layer)
        // The popup should contain a year and time fragment.
        expect(html).toMatch(/2024/)
        expect(html).not.toContain('2024-01-15T12:34:56Z')
    })

    it('leaves un-parseable date strings alone', () => {
        const layer = makeLayer()
        onEachFeature(
            featureWith({ name: 'p', start_time: 'not-a-date' }),
            layer as unknown as L.Layer,
        )
        expect(popupHtml(layer)).toContain('not-a-date')
    })

    it('renders the empty-metadata placeholder when only the name is present', () => {
        const layer = makeLayer()
        onEachFeature(featureWith({ name: 'Only Name' }), layer as unknown as L.Layer)
        const html = popupHtml(layer)
        expect(html).toContain('No additional metadata available')
    })
})
