import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JSZip from 'jszip'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { MAX_SPATIAL_FILE_SIZE_BYTES, MAX_SPATIAL_IMPORT_FILES } from '@/lib/spatialLimits'
import ImportPanel from './ImportPanel'

const KML_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark><name>P</name><Point><coordinates>1,2</coordinates></Point></Placemark>
  </Document>
</kml>`

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }))

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ toast: toastSpy, toasts: [], dismiss: vi.fn() }),
    toast: toastSpy,
}))

beforeAll(async () => {
    await initBackendUrl()
})

beforeEach(() => {
    toastSpy.mockClear()
})

function kmlFile(name = 'sample.kml', body = KML_BODY): File {
    return new File([body], name, { type: 'application/vnd.google-earth.kml+xml' })
}

async function kmzFile(name = 'sample.kmz', kmlBody = KML_BODY): Promise<File> {
    const zip = new JSZip()
    zip.file('doc.kml', kmlBody)
    const blob = await zip.generateAsync({ type: 'blob' })
    return new File([blob], name, { type: 'application/vnd.google-earth.kmz' })
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTitle('Import KML/KMZ'))
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof ImportPanel>> = {}) {
    const props = {
        selectedCaseId: 'case-1',
        onImportComplete: vi.fn(),
        onSaveComplete: vi.fn(),
        ...overrides,
    }
    return { props, ...render(<ImportPanel {...props} />) }
}

describe('ImportPanel - menu', () => {
    it('opens and closes via the upload button', async () => {
        const user = userEvent.setup()
        renderPanel()
        expect(screen.queryByText(/Import Spatial Data/i)).not.toBeInTheDocument()
        await openMenu(user)
        expect(screen.getByText(/Import Spatial Data/i)).toBeInTheDocument()
    })

    it('shows the empty drop zone when no files are queued', async () => {
        const user = userEvent.setup()
        renderPanel()
        await openMenu(user)
        expect(screen.getByText(/Click to upload or drag & drop/i)).toBeInTheDocument()
    })
})

describe('ImportPanel - file validation', () => {
    it('queues a single .kml file via the hidden input', async () => {
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, kmlFile('one.kml'))
        expect(await screen.findByText('one.kml')).toBeInTheDocument()
    })

    it('silently drops files whose extension is not .kml or .kmz', async () => {
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, new File(['x'], 'malicious.exe'))
        await new Promise((r) => setTimeout(r, 10))
        expect(screen.queryByText('malicious.exe')).not.toBeInTheDocument()
    })

    it('toasts when a file exceeds the per-file size limit', async () => {
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const huge = new File(
            [new Uint8Array(MAX_SPATIAL_FILE_SIZE_BYTES + 1)],
            'big.kml',
            { type: 'text/xml' },
        )
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, huge)
        expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                variant: 'destructive',
                title: 'File too large',
            }),
        )
    })

    it('toasts when total queue exceeds the per-import file count limit', async () => {
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        // Fill up to the limit, requerying the input each time because
        // the queued-files view replaces the input element.
        const filled = Array.from({ length: MAX_SPATIAL_IMPORT_FILES }, (_, i) =>
            kmlFile(`f${i}.kml`),
        )
        await user.upload(
            container.querySelector('input[type=file]') as HTMLInputElement,
            filled,
        )
        await screen.findByText('f0.kml')
        toastSpy.mockClear()
        // Try to add one more via the still-present input — should trigger the cap toast.
        await user.upload(
            container.querySelector('input[type=file]') as HTMLInputElement,
            kmlFile('extra.kml'),
        )
        expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                variant: 'destructive',
                title: 'Import limit reached',
            }),
        )
    })

    it('removes a single queued file via the X button', async () => {
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, kmlFile('to-remove.kml'))
        await screen.findByText('to-remove.kml')

        const fileRow = screen.getByText('to-remove.kml').closest('div.bg-\\[\\#212121\\]')
        const removeBtn = fileRow?.querySelector('button')
        expect(removeBtn).not.toBeNull()
        await user.click(removeBtn as HTMLElement)
        await waitFor(() =>
            expect(screen.queryByText('to-remove.kml')).not.toBeInTheDocument(),
        )
    })

    it('Clear button empties the file queue', async () => {
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, [kmlFile('a.kml'), kmlFile('b.kml')])
        await screen.findByText('a.kml')

        await user.click(screen.getByText('Clear'))
        await waitFor(() => expect(screen.queryByText('a.kml')).not.toBeInTheDocument())
    })
})

describe('ImportPanel - Temporary import', () => {
    it('parses .kml and calls onImportComplete with the parsed payload', async () => {
        const user = userEvent.setup()
        const onImportComplete = vi.fn()
        const { container } = renderPanel({ onImportComplete })
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, kmlFile('one.kml'))

        await user.click(screen.getByRole('button', { name: /Temporary/i }))

        await waitFor(() => expect(onImportComplete).toHaveBeenCalledTimes(1))
        const payload = onImportComplete.mock.calls[0][0]
        expect(payload).toHaveLength(1)
        expect(payload[0]).toMatchObject({
            name: 'one.kml',
            is_temporary: true,
            is_deletable: true,
        })
        expect(payload[0].data.features).toHaveLength(1)
    })

    it('parses .kmz by extracting the inner .kml', async () => {
        const user = userEvent.setup()
        const onImportComplete = vi.fn()
        const { container } = renderPanel({ onImportComplete })
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, await kmzFile('zipped.kmz'))

        await user.click(screen.getByRole('button', { name: /Temporary/i }))

        await waitFor(() => expect(onImportComplete).toHaveBeenCalled())
        expect(onImportComplete.mock.calls[0][0][0].name).toBe('zipped.kmz')
    })

    it('toasts when a .kmz contains no .kml entry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const zip = new JSZip()
        zip.file('readme.txt', 'no kml here')
        const blob = await zip.generateAsync({ type: 'blob' })
        const broken = new File([blob], 'broken.kmz', { type: 'application/zip' })
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, broken)

        await user.click(screen.getByRole('button', { name: /Temporary/i }))

        await waitFor(() =>
            expect(toastSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    variant: 'destructive',
                    title: 'Import failed',
                }),
            ),
        )
    })
})

describe('ImportPanel - Save to Case', () => {
    it('POSTs once per queued file and signals onSaveComplete', async () => {
        let postCount = 0
        server.use(
            http.post(apiUrl('/spatial/import'), () => {
                postCount += 1
                return HttpResponse.json({ ok: true })
            }),
        )

        const user = userEvent.setup()
        const onSaveComplete = vi.fn()
        const { container } = renderPanel({ onSaveComplete })
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, [kmlFile('a.kml'), kmlFile('b.kml')])
        await screen.findByText('a.kml')

        await user.click(screen.getByRole('button', { name: /Save to Case/i }))

        await waitFor(() => {
            expect(postCount).toBe(2)
            expect(onSaveComplete).toHaveBeenCalled()
        })
    })

    it('toasts the server error detail when /spatial/import fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        server.use(
            http.post(apiUrl('/spatial/import'), () =>
                HttpResponse.json({ detail: 'storage full' }, { status: 500 }),
            ),
        )

        const user = userEvent.setup()
        const { container } = renderPanel()
        await openMenu(user)
        const input = container.querySelector('input[type=file]') as HTMLInputElement
        await user.upload(input, kmlFile('a.kml'))

        await user.click(screen.getByRole('button', { name: /Save to Case/i }))

        await waitFor(() =>
            expect(toastSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Import failed',
                    description: 'storage full',
                }),
            ),
        )
    })
})
