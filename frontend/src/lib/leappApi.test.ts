import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { createLeappApi } from './leappApi'
import { initBackendUrl } from './api'

beforeAll(async () => {
    await initBackendUrl()
})

describe('createLeappApi - modules', () => {
    it('GETs modules with the tool query param', async () => {
        let requestedUrl: string | null = null
        server.use(
            http.get(apiUrl('/profiles/modules'), ({ request }) => {
                requestedUrl = request.url
                return HttpResponse.json({ modules: [{ name: 'm1' }] })
            }),
        )
        const api = createLeappApi('ileapp')
        const result = await api.modules.getAll()
        expect(result.modules).toHaveLength(1)
        expect(requestedUrl).toContain('tool=ileapp')
    })

    it('POSTs module selections with body { tool, selections }', async () => {
        let body: unknown = null
        server.use(
            http.post(apiUrl('/profiles/modules/select'), async ({ request }) => {
                body = await request.json()
                return HttpResponse.json({})
            }),
        )
        const api = createLeappApi('aleapp')
        await api.modules.select({ moduleA: true })
        expect(body).toEqual({ tool: 'aleapp', selections: { moduleA: true } })
    })
})

describe('createLeappApi - profiles', () => {
    it('loads a profile by id with tool in body', async () => {
        let requestedTool: unknown = null
        server.use(
            http.post(apiUrl('/profiles/:id/load'), async ({ request, params }) => {
                expect(params.id).toBe('42')
                const body = (await request.json()) as { tool: string }
                requestedTool = body.tool
                return HttpResponse.json({ message: 'ok', modules: ['m'] })
            }),
        )
        const api = createLeappApi('ileapp')
        const res = await api.profiles.load(42)
        expect(res.modules).toEqual(['m'])
        expect(requestedTool).toBe('ileapp')
    })

    it('saves a profile with name, modules, and tool', async () => {
        let body: { tool: string; name: string; modules: string[] } | null = null
        server.use(
            http.post(apiUrl('/profiles'), async ({ request }) => {
                body = (await request.json()) as typeof body
                return HttpResponse.json({ name: 'saved' })
            }),
        )
        const api = createLeappApi('ileapp')
        await api.profiles.save('saved', ['x'])
        expect(body).toEqual({ tool: 'ileapp', name: 'saved', modules: ['x'] })
    })

    it('deletes a profile by id', async () => {
        let calledMethod: string | null = null
        server.use(
            http.delete(apiUrl('/profiles/:id'), ({ request, params }) => {
                calledMethod = request.method
                expect(params.id).toBe('7')
                return HttpResponse.json({ message: 'deleted' })
            }),
        )
        const api = createLeappApi('ileapp')
        await api.profiles.delete(7)
        expect(calledMethod).toBe('DELETE')
    })
})

describe('createLeappApi - processing', () => {
    it('starts processing with the full body shape', async () => {
        let body: Record<string, unknown> | null = null
        server.use(
            http.post(apiUrl('/process/start'), async ({ request }) => {
                body = (await request.json()) as Record<string, unknown>
                return HttpResponse.json({ task_id: 'task-xyz' })
            }),
        )
        const api = createLeappApi('ileapp')
        const res = await api.processing.start('/in', '/out', ['m1'], 'My Report', 'pw', 99)
        expect(res.task_id).toBe('task-xyz')
        expect(body).toMatchObject({
            tool: 'ileapp',
            input_path: '/in',
            output_folder: '/out',
            selected_modules: ['m1'],
            report_name: 'My Report',
            password: 'pw',
            case_id: 99,
        })
    })

    it('falls back to a generated case_name when reportName is absent', async () => {
        let body: Record<string, unknown> | null = null
        server.use(
            http.post(apiUrl('/process/start'), async ({ request }) => {
                body = (await request.json()) as Record<string, unknown>
                return HttpResponse.json({ task_id: 't' })
            }),
        )
        const api = createLeappApi('ileapp')
        await api.processing.start('/in', '/out', [])
        expect(body?.case_name).toMatch(/^Case_\d+$/)
    })

    it('stops a task by id', async () => {
        let body: Record<string, unknown> | null = null
        server.use(
            http.post(apiUrl('/process/stop'), async ({ request }) => {
                body = (await request.json()) as Record<string, unknown>
                return HttpResponse.json({})
            }),
        )
        const api = createLeappApi('ileapp')
        await api.processing.stop('task-abc')
        expect(body).toEqual({ task_id: 'task-abc' })
    })

    it('createEventSource returns an EventSource pointing at the stream endpoint', () => {
        const api = createLeappApi('ileapp')
        const es = api.processing.createEventSource('task-1')
        expect(es.url).toContain('/api/process/stream/task-1')
        es.close()
    })
})

describe('createLeappApi - backups', () => {
    it('GETs devices', async () => {
        server.use(
            http.get(apiUrl('/backups/devices'), () =>
                HttpResponse.json([{ udid: 'abc', name: 'iPhone' }]),
            ),
        )
        const api = createLeappApi('ileapp')
        const devices = await api.backup.getDevices()
        expect(devices).toEqual([{ udid: 'abc', name: 'iPhone' }])
    })

    it('GETs backups scoped by caseId when provided', async () => {
        let requestedUrl: string | null = null
        server.use(
            http.get(apiUrl('/backups'), ({ request }) => {
                requestedUrl = request.url
                return HttpResponse.json([])
            }),
        )
        const api = createLeappApi('ileapp')
        await api.backup.getBackups(5)
        expect(requestedUrl).toContain('case_id=5')
    })

    it('GETs all backups when caseId is omitted', async () => {
        let requestedUrl: string | null = null
        server.use(
            http.get(apiUrl('/backups'), ({ request }) => {
                requestedUrl = request.url
                return HttpResponse.json([])
            }),
        )
        const api = createLeappApi('ileapp')
        await api.backup.getBackups()
        expect(requestedUrl).not.toContain('case_id=')
    })

    it('startBackup posts the right body and returns backup_id', async () => {
        let body: Record<string, unknown> | null = null
        server.use(
            http.post(apiUrl('/backups'), async ({ request }) => {
                body = (await request.json()) as Record<string, unknown>
                return HttpResponse.json({ backup_id: 11 })
            }),
        )
        const api = createLeappApi('ileapp')
        const res = await api.backup.startBackup('udid-1', 'backup name', 3, 'secret')
        expect(res.backup_id).toBe(11)
        expect(body).toEqual({
            udid: 'udid-1',
            name: 'backup name',
            case_id: 3,
            password: 'secret',
        })
    })
})

describe('createLeappApi - error handling', () => {
    let consoleError: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleError.mockRestore()
    })

    it('throws an Error including the HTTP status when response is not ok', async () => {
        server.use(
            http.get(apiUrl('/profiles/modules'), () =>
                HttpResponse.json({}, { status: 500 }),
            ),
        )
        const api = createLeappApi('ileapp')
        await expect(api.modules.getAll()).rejects.toThrow('API Error: 500')
    })

    it('propagates 404 errors from profile load', async () => {
        server.use(
            http.post(apiUrl('/profiles/:id/load'), () =>
                HttpResponse.json({}, { status: 404 }),
            ),
        )
        const api = createLeappApi('ileapp')
        await expect(api.profiles.load(99)).rejects.toThrow('API Error: 404')
    })
})
