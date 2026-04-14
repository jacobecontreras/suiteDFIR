import { useEffect, useState } from 'react'
import { API } from '@/lib/api'

/**
 * Checks whether a Google Maps API key is configured on the backend.
 * Re-checks whenever `refreshKey` changes (e.g. after saving/clearing a key).
 */
export function useGoogleApiKey(refreshKey: number = 0) {
    const [hasKey, setHasKey] = useState(false)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        setIsLoading(true)

        const check = async () => {
            try {
                const res = await fetch(API.path('/settings/google_maps_api_key'))
                if (cancelled) return

                if (res.ok) {
                    const data = await res.json()
                    setHasKey(data.value !== '')
                } else {
                    setHasKey(false)
                }
            } catch {
                if (!cancelled) setHasKey(false)
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }

        check()
        return () => { cancelled = true }
    }, [refreshKey])

    return { hasKey, isLoading }
}
