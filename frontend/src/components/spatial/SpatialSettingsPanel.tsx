import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Eye, EyeOff, Loader2, Settings, X } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select"
import { API } from "@/lib/api"
import { useToast } from "@/hooks/useToast"
import { useClickOutside } from "@/hooks/useClickOutside"
import { useSpatial } from "@/context/SpatialContext"

const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org"
const DEFAULT_NOMINATIM_USER_AGENT = "suiteDFIR/1.0 (+https://github.com/jacobcontreras/suiteDFIR)"

export default function SpatialSettingsPanel() {
    const { toast } = useToast()
    const { tileSource, setTileSource, refreshApiKey } = useSpatial()
    const panelRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [apiKey, setApiKey] = useState("")
    const [showKey, setShowKey] = useState(false)
    const [showClearConfirm, setShowClearConfirm] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [saved, setSaved] = useState(false)
    const [hasExistingKey, setHasExistingKey] = useState(false)
    const [geocoderProvider, setGeocoderProvider] = useState("nominatim")
    const [nominatimBaseUrl, setNominatimBaseUrl] = useState(DEFAULT_NOMINATIM_URL)
    const [nominatimUserAgent, setNominatimUserAgent] = useState(DEFAULT_NOMINATIM_USER_AGENT)

    const hasGoogleKeyConfigured = apiKey.trim().length > 0
    const effectiveProvider = tileSource === "google" ? geocoderProvider : "nominatim"

    const suppressClickWhen = useCallback(() => showClearConfirm, [showClearConfirm])

    useClickOutside(
        [panelRef, triggerRef],
        () => { setIsOpen(false); setShowClearConfirm(false) },
        {
            enabled: isOpen,
            onEscape: showClearConfirm
                ? () => setShowClearConfirm(false)
                : () => setIsOpen(false),
            suppressClickWhen,
        }
    )

    useEffect(() => {
        if (!hasGoogleKeyConfigured && geocoderProvider === "google") {
            setGeocoderProvider("nominatim")
        }
    }, [geocoderProvider, hasGoogleKeyConfigured])

    useEffect(() => {
        if (!isOpen) return

        const loadSettings = async () => {
            setIsLoading(true)
            try {
                const [apiKeyRes, providerRes, baseUrlRes, userAgentRes] = await Promise.allSettled([
                    fetch(API.path("/settings/google_maps_api_key")),
                    fetch(API.path("/settings/geocoder_provider")),
                    fetch(API.path("/settings/nominatim_base_url")),
                    fetch(API.path("/settings/nominatim_user_agent")),
                ])

                if (apiKeyRes.status === "fulfilled" && apiKeyRes.value.ok) {
                    const data = await apiKeyRes.value.json()
                    setApiKey(data.value)
                    setHasExistingKey(Boolean(data.value))
                } else if (apiKeyRes.status === "fulfilled" && apiKeyRes.value.status === 404) {
                    // Key not found (404) means no key is set
                    setApiKey("")
                    setHasExistingKey(false)
                }

                if (providerRes.status === "fulfilled" && providerRes.value.ok) {
                    const data = await providerRes.value.json()
                    if (data.value === "google" || data.value === "nominatim") {
                        setGeocoderProvider(data.value)
                    }
                }

                if (baseUrlRes.status === "fulfilled" && baseUrlRes.value.ok) {
                    const data = await baseUrlRes.value.json()
                    setNominatimBaseUrl(data.value || DEFAULT_NOMINATIM_URL)
                }

                if (userAgentRes.status === "fulfilled" && userAgentRes.value.ok) {
                    const data = await userAgentRes.value.json()
                    setNominatimUserAgent(data.value || DEFAULT_NOMINATIM_USER_AGENT)
                }
            } catch {
                setNominatimBaseUrl(DEFAULT_NOMINATIM_URL)
                setNominatimUserAgent(DEFAULT_NOMINATIM_USER_AGENT)
            } finally {
                setIsLoading(false)
            }
        }

        loadSettings()
    }, [isOpen])

    const handleSaveAll = async () => {
        const normalizedKey = apiKey.trim()
        const normalizedBaseUrl = nominatimBaseUrl.trim().replace(/\/+$/, "") || DEFAULT_NOMINATIM_URL
        const normalizedUserAgent = nominatimUserAgent.trim() || DEFAULT_NOMINATIM_USER_AGENT

        // Check if user is clearing an existing key by saving with empty input
        const isClearingKey = normalizedKey === "" && hasExistingKey

        setIsSaving(true)
        setSaved(false)
        try {
            if (normalizedKey) {
                const verifyRes = await fetch(API.path("/settings/verify/google-maps-key"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value: normalizedKey }),
                })
                const verification = await verifyRes.json()

                if (!verifyRes.ok || !verification.valid) {
                    toast({
                        variant: "destructive",
                        title: "API key verification failed",
                        description: verification?.message || "Google Maps services could not verify this key.",
                    })
                    return
                }
            }

            const responses = await Promise.all([
                // If clearing an existing key, use DELETE. Otherwise, PUT if there's a new key.
                ...(isClearingKey
                    ? [fetch(API.path("/settings/google_maps_api_key"), { method: "DELETE" })]
                    : (normalizedKey
                        ? [fetch(API.path("/settings/google_maps_api_key"), {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ value: normalizedKey }),
                        })]
                        : []
                    )
                ),
                fetch(API.path("/settings/geocoder_provider"), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value: isClearingKey ? "nominatim" : geocoderProvider }),
                }),
                fetch(API.path("/settings/nominatim_base_url"), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value: normalizedBaseUrl }),
                }),
                fetch(API.path("/settings/nominatim_user_agent"), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value: normalizedUserAgent }),
                }),
            ])

            if (!responses.every((res) => res.ok)) {
                throw new Error("One or more settings failed to save")
            }

            setApiKey(normalizedKey)
            setHasExistingKey(Boolean(normalizedKey))
            setNominatimBaseUrl(normalizedBaseUrl)
            setNominatimUserAgent(normalizedUserAgent)
            setSaved(true)

            // If clearing a key, switch to OSM tiles if currently on Google
            if (isClearingKey && tileSource === 'google') {
                setTileSource('osm')
            }

            // Trigger refresh of API key status across components when a key was saved or cleared
            if (normalizedKey || isClearingKey) {
                refreshApiKey()
            }

            toast({
                title: "Spatial settings saved",
                description: isClearingKey
                    ? "API key cleared. Geocoding will use Nominatim (OpenStreetMap)."
                    : normalizedKey
                    ? "Google Maps and geocoder settings were updated."
                    : "Geocoder settings were updated.",
            })
            setTimeout(() => setSaved(false), 3000)
            setIsOpen(false)
        } catch (error) {
            console.error("Failed to save spatial settings:", error)
            toast({
                variant: "destructive",
                title: "Failed to save settings",
                description: "The spatial settings could not be updated right now.",
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleClearKey = async () => {
        setIsSaving(true)
        try {
            // Reset geocoder_provider first - if this fails, don't delete the key
            const providerRes = await fetch(API.path("/settings/geocoder_provider"), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value: "nominatim" }),
            })
            if (!providerRes.ok) {
                throw new Error("Failed to reset geocoder provider")
            }

            // Now delete the API key (idempotent - 200 OK whether existed or not)
            const deleteRes = await fetch(API.path("/settings/google_maps_api_key"), {
                method: "DELETE",
            })
            if (!deleteRes.ok) {
                throw new Error("Failed to clear key")
            }

            // Update local state immediately
            setApiKey("")
            setHasExistingKey(false)
            setGeocoderProvider("nominatim")
            setShowClearConfirm(false)

            // Switch to OSM tiles if currently on Google tiles
            if (tileSource === 'google') {
                setTileSource('osm')
            }

            // Trigger refresh of API key status across components
            refreshApiKey()

            toast({
                title: "API key cleared",
                description: "Google Maps API key has been removed. Geocoding will use Nominatim (OpenStreetMap).",
            })
        } catch {
            toast({
                variant: "destructive",
                title: "Failed to clear key",
                description: "Could not remove the API key. Please try again.",
            })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    if (isOpen) {
                        setIsOpen(false)
                    } else {
                        setIsOpen(true)
                    }
                }}
                className="h-8 w-8 bg-[#1f1f1f] border border-[#414141] rounded-md shadow-lg transition-colors hover:bg-[#333333] text-[#fafafa] inline-flex items-center justify-center"
                aria-label="Spatial settings"
                title="Spatial settings"
            >
                <Settings className="h-4 w-4" />
            </button>

            {isOpen && (
                <div
                    ref={panelRef}
                    className="absolute top-10 right-0 w-[min(24rem,calc(100vw-2rem))] max-h-[min(38rem,calc(100vh-6rem))] overflow-y-auto rounded-xl border border-[#333333] bg-[#151515]/98 p-4 shadow-2xl backdrop-blur-sm"
                >
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                            <h3 className="text-sm font-medium text-white">Google Maps API Key</h3>
                            <p className="text-[11px] text-gray-500">
                                Required for Google tile layers and Google geocoding.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-[#242424] hover:text-white"
                            aria-label="Close spatial settings"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <div className="relative">
                                    <Input
                                        type={showKey ? "text" : "password"}
                                        value={apiKey}
                                        onChange={(e) => {
                                            setApiKey(e.target.value)
                                            setSaved(false)
                                        }}
                                        placeholder="Enter your Google Maps API key..."
                                        className="w-full pr-10 h-10 text-[13px] bg-[#1A1A1A] border border-[#333333] text-white placeholder:text-gray-600 focus-visible:ring-1 focus-visible:ring-gray-500 rounded-md"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowKey((current) => !current)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-gray-300"
                                    >
                                        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                {hasExistingKey && !saved && (
                                    <p className="text-[11px] font-medium text-gray-500">Key configured</p>
                                )}
                                {hasExistingKey && (
                                    <button
                                        type="button"
                                        onClick={() => setShowClearConfirm(true)}
                                        className="text-[11px] text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1 mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                        disabled={isSaving}
                                    >
                                        <X size={12} />
                                        Clear API key
                                    </button>
                                )}
                            </div>

                            <div className="space-y-4 border-t border-[#2A2A2A] pt-4">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-medium text-white">Geocoder Provider</h3>
                                    <p className="text-[12px] text-gray-500">
                                        Public Nominatim should be treated as light-use fallback only. Higher-volume use should use Google or your own provider.
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Provider</label>
                                        <Select value={tileSource === "google" ? geocoderProvider : effectiveProvider} onValueChange={setGeocoderProvider}>
                                            <SelectTrigger disabled={tileSource !== "google"} className="h-10 bg-[#1A1A1A] border border-[#333333] text-white rounded-md">
                                                <SelectValue>
                                                    {(tileSource === "google" ? geocoderProvider : effectiveProvider) === "google" ? "Google Maps" : "Nominatim"}
                                                </SelectValue>
                                            </SelectTrigger>
                                            <SelectContent className="w-full">
                                                <SelectItem value="nominatim">Nominatim</SelectItem>
                                                <SelectItem value="google" disabled={!hasGoogleKeyConfigured}>
                                                    Google Maps
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {!hasGoogleKeyConfigured && (
                                            <p className="text-[12px] text-gray-500">
                                                Add and verify a Google Maps API key above to enable Google geocoding.
                                            </p>
                                        )}
                                        <div className="rounded-md border border-[#2A2A2A] bg-[#101010] px-3 py-2 text-[12px] text-gray-400">
                                            {tileSource !== "google"
                                                ? "Provider selection is locked to Nominatim on OSM tiles. Switch to Google tiles to use Google geocoding."
                                                : `Current map uses ${effectiveProvider === "google" ? "Google Maps geocoding" : "Nominatim geocoding"}.`}
                                        </div>
                                    </div>

                                    {effectiveProvider === "nominatim" && (
                                        <>
                                            <div className="space-y-2">
                                                <label className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Nominatim Service URL</label>
                                                <Input
                                                    value={nominatimBaseUrl}
                                                    onChange={(e) => {
                                                        setNominatimBaseUrl(e.target.value)
                                                        setSaved(false)
                                                    }}
                                                    placeholder={DEFAULT_NOMINATIM_URL}
                                                    className="h-10 text-[13px] bg-[#1A1A1A] border border-[#333333] text-white placeholder:text-gray-600 focus-visible:ring-1 focus-visible:ring-gray-500 rounded-md"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Nominatim User-Agent</label>
                                                <Input
                                                    value={nominatimUserAgent}
                                                    onChange={(e) => {
                                                        setNominatimUserAgent(e.target.value)
                                                        setSaved(false)
                                                    }}
                                                    placeholder={DEFAULT_NOMINATIM_USER_AGENT}
                                                    className="h-10 text-[13px] bg-[#1A1A1A] border border-[#333333] text-white placeholder:text-gray-600 focus-visible:ring-1 focus-visible:ring-gray-500 rounded-md"
                                                />
                                                <p className="text-[12px] text-gray-500">
                                                    This app uses explicit submit-based search only. Public Nominatim autocomplete is disabled to comply with OSM policy.
                                                </p>
                                            </div>
                                        </>
                                    )}

                                    <div className="space-y-2 border-t border-[#2A2A2A] pt-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <h4 className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Google Terms</h4>
                                            {saved && <p className="text-[11px] font-medium text-gray-500">Saved</p>}
                                        </div>
                                        <div className="space-y-1 text-[12px]">
                                            <a
                                                href="https://cloud.google.com/maps-platform/terms"
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block text-gray-400 transition-colors hover:text-white"
                                            >
                                                Google Maps Platform Terms of Service
                                            </a>
                                            <a
                                                href="https://cloud.google.com/maps-platform/terms/maps-service-terms"
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block text-gray-400 transition-colors hover:text-white"
                                            >
                                                Google Maps Platform Service Specific Terms
                                            </a>
                                            <a
                                                href="https://policies.google.com/privacy"
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block text-gray-400 transition-colors hover:text-white"
                                            >
                                                Google Privacy Policy
                                            </a>
                                        </div>
                                        <div className="flex justify-end pt-2">
                                            <Button
                                                size="sm"
                                                onClick={handleSaveAll}
                                                disabled={isSaving}
                                                className="bg-white text-black hover:bg-gray-200 text-[11px] font-bold uppercase tracking-wider h-10 px-6 shrink-0"
                                            >
                                                {isSaving ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : saved ? (
                                                    <><Check size={12} className="mr-1" /> Saved</>
                                                ) : (
                                                    "Update"
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {showClearConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => {
                    if (e.target === e.currentTarget) setShowClearConfirm(false)
                }}>
                    <div className="bg-[#1A1A1A] border border-[#333333] rounded-lg p-4 max-w-sm mx-4">
                        <p className="text-sm text-white mb-4">Clear Google Maps API key? Geocoding will fall back to Nominatim (OpenStreetMap).</p>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)}>
                                Cancel
                            </Button>
                            <Button variant="destructive" size="sm" onClick={handleClearKey} disabled={isSaving}>
                                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Clear Key"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
