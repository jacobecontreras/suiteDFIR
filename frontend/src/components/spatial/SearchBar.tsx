import { useState, useRef, useEffect } from "react"
import { Search, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/Input"
import { cn } from "@/lib/utils"
import { API } from "@/lib/api"
import { useSpatial } from "@/context/SpatialContext"
import { useClickOutside } from "@/hooks/useClickOutside"

interface PlaceSuggestion {
    place_id: string
    display_name: string
    primary_text?: string | null
    secondary_text?: string | null
}

interface SearchBarProps {
    onSearch: (lat: number, lon: number) => void
    currentTileSource: 'osm' | 'google'
}

export default function SearchBar({ onSearch, currentTileSource }: SearchBarProps) {
    const { searchQuery, setSearchQuery, setSearchPin } = useSpatial()
    const [isSearching, setIsSearching] = useState(false)
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
    const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1)

    const searchContainerRef = useRef<HTMLDivElement>(null)
    const autocompleteSessionRef = useRef<string | null>(null)

    useClickOutside(
        [searchContainerRef],
        () => { setShowSuggestions(false); setHighlightedSuggestionIndex(-1) },
        { enabled: showSuggestions }
    )

    // Autocomplete effect (Google only, debounced)
    useEffect(() => {
        const trimmedQuery = searchQuery.trim()
        if (currentTileSource !== "google" || trimmedQuery.length < 3) {
            setSuggestions([])
            setShowSuggestions(false)
            setHighlightedSuggestionIndex(-1)
            if (!trimmedQuery || currentTileSource !== "google") {
                autocompleteSessionRef.current = null
            }
            return
        }

        const sessionToken = autocompleteSessionRef.current ?? window.crypto.randomUUID()
        autocompleteSessionRef.current = sessionToken

        let cancelled = false
        const timeoutId = window.setTimeout(async () => {
            setIsLoadingSuggestions(true)
            try {
                const res = await fetch(
                    API.path(
                        `/spatial/autocomplete?q=${encodeURIComponent(trimmedQuery)}&session_token=${encodeURIComponent(sessionToken)}&basemap=${encodeURIComponent(currentTileSource)}`
                    )
                )
                if (!res.ok) throw new Error("Autocomplete request failed")

                const data: PlaceSuggestion[] = await res.json()
                if (cancelled) return

                setSuggestions(data)
                setShowSuggestions(data.length > 0)
                setHighlightedSuggestionIndex(data.length > 0 ? 0 : -1)
            } catch (error) {
                if (!cancelled) {
                    console.error("Autocomplete failed:", error)
                    setSuggestions([])
                    setShowSuggestions(false)
                    setHighlightedSuggestionIndex(-1)
                }
            } finally {
                if (!cancelled) setIsLoadingSuggestions(false)
            }
        }, 250)

        return () => {
            cancelled = true
            window.clearTimeout(timeoutId)
        }
    }, [currentTileSource, searchQuery])

    const resetAutocomplete = () => {
        setSuggestions([])
        setShowSuggestions(false)
        setHighlightedSuggestionIndex(-1)
        autocompleteSessionRef.current = null
    }

    const runSearch = async (query: string) => {
        setIsSearching(true)
        try {
            const res = await fetch(
                API.path(`/spatial/search?q=${encodeURIComponent(query)}&basemap=${encodeURIComponent(currentTileSource)}`)
            )
            if (res.ok) {
                const data = await res.json()
                if (data && data.length > 0) {
                    const { lat, lon } = data[0]
                    onSearch(parseFloat(lat), parseFloat(lon))
                }
            }
        } catch (error) {
            console.error("Search failed:", error)
        } finally {
            setIsSearching(false)
        }
    }

    const handleSuggestionSelect = async (suggestion: PlaceSuggestion) => {
        setSearchQuery(suggestion.display_name)
        resetAutocomplete()
        await runSearch(suggestion.display_name)
    }

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!searchQuery.trim()) return

        if (showSuggestions && highlightedSuggestionIndex >= 0 && suggestions[highlightedSuggestionIndex]) {
            await handleSuggestionSelect(suggestions[highlightedSuggestionIndex])
            return
        }

        resetAutocomplete()
        await runSearch(searchQuery.trim())
    }

    const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showSuggestions || suggestions.length === 0) {
            if (e.key === "Escape") resetAutocomplete()
            return
        }

        if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlightedSuggestionIndex((current) => (current + 1) % suggestions.length)
            return
        }
        if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlightedSuggestionIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
            return
        }
        if (e.key === "Escape") {
            e.preventDefault()
            resetAutocomplete()
        }
    }

    return (
        <div ref={searchContainerRef} className="pointer-events-auto w-full max-w-[320px] shadow-lg relative">
            <form onSubmit={handleSearch}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                    value={searchQuery}
                    onChange={(e) => {
                        const newQuery = e.target.value;
                        setSearchQuery(newQuery);
                        if (!newQuery.trim()) {
                            setSearchPin(null);
                            resetAutocomplete();
                        }
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search location and press Enter..."
                    className="pl-9 pr-3 h-8 w-full !bg-[#1f1f1f] hover:!bg-[#262626] focus:!bg-[#262626] !border-[#414141] text-white placeholder:text-muted-foreground placeholder:text-[11px] text-xs focus-visible:ring-0 focus-visible:ring-offset-0 transition-colors shadow-md"
                />
                {(isSearching || isLoadingSuggestions) && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 animate-spin" />
                )}
            </form>

            {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-10 left-0 right-0 overflow-hidden rounded-lg border border-[#414141] bg-[#1A1A1A] shadow-xl">
                    <div className="max-h-[260px] overflow-y-auto py-1">
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={suggestion.place_id}
                                type="button"
                                onClick={() => void handleSuggestionSelect(suggestion)}
                                className={cn(
                                    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors",
                                    index === highlightedSuggestionIndex ? "bg-[#2A2A2A]" : "hover:bg-[#242424]"
                                )}
                            >
                                <span className="text-xs font-medium text-white">
                                    {suggestion.primary_text || suggestion.display_name}
                                </span>
                                {suggestion.secondary_text && (
                                    <span className="text-[11px] text-gray-500">
                                        {suggestion.secondary_text}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    <div
                        className="border-t border-[#2A2A2A] px-3 py-1.5 font-normal text-[12px] text-[#5E5E5E]"
                        translate="no"
                    >
                        Google Maps
                    </div>
                </div>
            )}
        </div>
    )
}
