import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { MockEventSource } from '@/test/mockEventSource'
import {
    BackupProcessingState,
    INITIAL_BACKUP_PROCESSING,
    useBackupProcessing,
} from './useBackupProcessing'
import { createLeappApi } from '@/lib/leappApi'
import type { Backup } from '@/types/backup'

beforeAll(async () => {
    await initBackendUrl()
})

beforeEach(() => {
    MockEventSource.reset()
})

function useHarness(type: 'ios' | 'android' = 'ios', initialBackups: Backup[] = []) {
    const [processing, setProcessing] = useState<BackupProcessingState>(INITIAL_BACKUP_PROCESSING)
    const [backups, setBackups] = useState<Backup[]>(initialBackups)
    const fetchBackupsRef = useRef(vi.fn(async () => {}))
    const hook = useBackupProcessing({
        type,
        processing,
        setProcessing: (updater) => setProcessing(updater),
        setBackups,
        fetchBackups: fetchBackupsRef.current,
        hasFetchedBackups: true,
        backups,
    })
    return { processing, backups, hook, fetchBackups: fetchBackupsRef.current }
}

describe('useBackupProcessing.startBackup', () => {
    it('initializes state and opens a stream when start succeeds', async () => {
        server.use(
            http.post(apiUrl('/backups'), () =>
                HttpResponse.json({ backup_id: 42 }),
            ),
        )

        const { result } = renderHook(() => useHarness('ios'))
        const api = createLeappApi('ileapp')

        await act(async () => {
            await result.current.hook.startBackup(
                api,
                'udid-1',
                'My Backup',
                { isEncrypted: false, backupPassword: '' },
            )
        })

        expect(result.current.processing.isRunning).toBe(true)
        expect(result.current.processing.activeBackupId).toBe(42)
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(true)
        const es = MockEventSource.last()
        expect(es.url).toContain('/api/backups/42/stream')
    })

    it('clears isAwaitingDevicePasscode for android backups', async () => {
        server.use(
            http.post(apiUrl('/backups'), () =>
                HttpResponse.json({ backup_id: 1 }),
            ),
        )
        const { result } = renderHook(() => useHarness('android'))
        const api = createLeappApi('aleapp')
        await act(async () => {
            await result.current.hook.startBackup(api, 'u', 'n', {
                isEncrypted: false,
                backupPassword: '',
            })
        })
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(false)
    })

    it('rethrows when startBackup fails and clears running state', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        server.use(
            http.post(apiUrl('/backups'), () =>
                HttpResponse.json({}, { status: 500 }),
            ),
        )

        const { result } = renderHook(() => useHarness('ios'))
        const api = createLeappApi('ileapp')

        await act(async () => {
            await expect(
                result.current.hook.startBackup(api, 'u', 'n', {
                    isEncrypted: false,
                    backupPassword: '',
                }),
            ).rejects.toThrow()
        })

        expect(result.current.processing.isRunning).toBe(false)
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(false)
    })

    it('passes the password to the API when encrypted', async () => {
        let body: { password?: string } | null = null
        server.use(
            http.post(apiUrl('/backups'), async ({ request }) => {
                body = (await request.json()) as typeof body
                return HttpResponse.json({ backup_id: 1 })
            }),
        )
        const { result } = renderHook(() => useHarness('ios'))
        const api = createLeappApi('ileapp')

        await act(async () => {
            await result.current.hook.startBackup(api, 'u', 'n', {
                isEncrypted: true,
                backupPassword: 'secret',
            })
        })

        expect(body?.password).toBe('secret')
    })
})

describe('useBackupProcessing - stream message handling', () => {
    async function setupRunningBackup(type: 'ios' | 'android' = 'ios') {
        server.use(
            http.post(apiUrl('/backups'), () =>
                HttpResponse.json({ backup_id: 7 }),
            ),
        )
        const initial: Backup[] = [
            { id: 7, name: 'b', device_name: 'd', path: '/', created_at: '', type },
        ]
        const harness = renderHook(() => useHarness(type, initial))
        const api = createLeappApi('ileapp')
        await act(async () => {
            await harness.result.current.hook.startBackup(api, 'u', 'n', {
                isEncrypted: false,
                backupPassword: '',
            })
        })
        return harness
    }

    it('appends log messages from JSON events', async () => {
        const { result } = await setupRunningBackup('ios')
        const es = MockEventSource.last()
        act(() => es.emitMessage({ type: 'log', message: 'hello world' }))
        expect(result.current.processing.logs).toContain('hello world')
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(false)
    })

    it('stores progress logs by progress_type and updates backup percent', async () => {
        const { result } = await setupRunningBackup('ios')
        const es = MockEventSource.last()
        act(() =>
            es.emitMessage({
                type: 'progress',
                progress_type: 'overall',
                message: 'overall: 42.5%',
            }),
        )
        expect(result.current.processing.progressLogs.overall).toBe('overall: 42.5%')
        expect(result.current.backups.find((b) => b.id === 7)?.progress).toBe(43)
    })

    it('does not update backup percent for non-overall progress types', async () => {
        const { result } = await setupRunningBackup('ios')
        const es = MockEventSource.last()
        act(() =>
            es.emitMessage({
                type: 'progress',
                progress_type: 'file',
                message: '5%',
            }),
        )
        expect(result.current.backups.find((b) => b.id === 7)?.progress).toBeUndefined()
    })

    it('flags awaiting passcode on the iOS prompt event', async () => {
        const { result } = await setupRunningBackup('ios')
        const es = MockEventSource.last()
        act(() =>
            es.emitMessage({ type: 'prompt', prompt_type: 'device_passcode' }),
        )
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(true)
    })

    it('ignores the iOS passcode prompt on android backups', async () => {
        const { result } = await setupRunningBackup('android')
        const es = MockEventSource.last()
        act(() =>
            es.emitMessage({ type: 'prompt', prompt_type: 'device_passcode' }),
        )
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(false)
    })

    it('falls back to plain-text log appending on JSON parse failure', async () => {
        const { result } = await setupRunningBackup('ios')
        const es = MockEventSource.last()
        act(() => es.emitMessage('legacy plain text'))
        expect(result.current.processing.logs).toContain('legacy plain text')
    })

    it('refetches backups when the stream closes', async () => {
        const { result } = await setupRunningBackup('ios')
        const es = MockEventSource.last()
        act(() => es.dispatchEvent(new Event('close')))
        await waitFor(() => {
            expect(result.current.fetchBackups).toHaveBeenCalled()
            expect(result.current.processing.isRunning).toBe(false)
        })
    })
})

describe('useBackupProcessing.stopBackup', () => {
    it('POSTs to /backups/:id/stop and clears running state', async () => {
        let stopHit = false
        server.use(
            http.post(apiUrl('/backups/:id/stop'), () => {
                stopHit = true
                return HttpResponse.json({})
            }),
        )

        const { result } = renderHook(() => useHarness('ios'))
        await act(async () => {
            await result.current.hook.stopBackup(123)
        })

        expect(stopHit).toBe(true)
        expect(result.current.processing.isRunning).toBe(false)
        expect(result.current.processing.activeBackupId).toBeNull()
        expect(result.current.fetchBackups).toHaveBeenCalled()
    })
})

describe('useBackupProcessing.clearLogs', () => {
    it('clears logs, progressLogs, and the passcode flag', () => {
        const { result } = renderHook(() => useHarness('ios'))
        act(() => result.current.hook.clearLogs())
        expect(result.current.processing.logs).toEqual([])
        expect(result.current.processing.progressLogs).toEqual({})
        expect(result.current.processing.isAwaitingDevicePasscode).toBe(false)
    })
})
