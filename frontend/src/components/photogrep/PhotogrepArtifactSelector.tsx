export interface PhotogrepArtifact {
    key: string
    label: string
    description: string
    slow?: boolean
}

export const PHOTOGREP_ARTIFACTS: PhotogrepArtifact[] = [
    { key: 'camera_roll', label: 'Camera Roll', description: 'Standard Camera Roll images' },
    { key: 'face_crops', label: 'Face Crops', description: 'Face crop BLOBs from Photos.sqlite' },
    { key: 'contact_photos', label: 'Contact Photos', description: 'Photos from AddressBook' },
    { key: 'imessage_attachments', label: 'iMessage Attachments', description: 'Image attachments from iMessage' },
    { key: 'whatsapp_images', label: 'WhatsApp Images', description: 'Images from WhatsApp' },
    { key: 'notes_attachments', label: 'Notes Attachments', description: 'Image attachments from Notes' },
    { key: 'photo_metadata', label: 'Photo Metadata', description: 'GPS, dates, camera info from EXIF & Photos.sqlite' },
    { key: 'search_index', label: 'Search Index', description: 'CLIP semantic search index (~350MB model download)', slow: true },
]

export const ALL_ARTIFACT_KEYS = PHOTOGREP_ARTIFACTS.map(a => a.key)

interface PhotogrepArtifactSelectorProps {
    selectedArtifacts: string[]
    onToggle: (key: string, selected: boolean) => void
    onSelectAll: () => void
    onSelectNone: () => void
    isProcessing: boolean
}

export default function PhotogrepArtifactSelector({
    selectedArtifacts,
    onToggle,
    onSelectAll,
    onSelectNone,
    isProcessing,
}: PhotogrepArtifactSelectorProps) {
    const selectedSet = new Set(selectedArtifacts)

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1 relative -top-[3px]">
                Artifact Selection
            </label>

            <div
                className="flex-1 overflow-hidden rounded-lg border flex flex-col"
                style={{ backgroundColor: '#171717', borderColor: '#333333' }}
            >
                {/* Selection Controls Header */}
                <div className="px-3 py-2 border-b border-[#333333] bg-[#1A1A1A] flex items-center justify-between shrink-0">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Selection: <span className="text-white ml-1">{selectedSet.size}/{PHOTOGREP_ARTIFACTS.length}</span>
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={onSelectAll}
                            disabled={isProcessing}
                            className="text-[10px] font-bold text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-[#262626] uppercase tracking-wider"
                        >
                            All
                        </button>
                        <button
                            onClick={onSelectNone}
                            disabled={isProcessing}
                            className="text-[10px] font-bold text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-[#262626] uppercase tracking-wider"
                        >
                            None
                        </button>
                    </div>
                </div>

                <div className="relative flex-1 min-h-0">
                    <div className="absolute inset-0 pointer-events-none z-10 scroll-mask" />
                    <div className="absolute inset-0 p-3 pt-6 pb-6 overflow-y-auto custom-scrollbar smooth-scroll">
                        <div className="space-y-0.5">
                            {PHOTOGREP_ARTIFACTS.map((artifact) => (
                                <label
                                    key={artifact.key}
                                    className="flex items-center space-x-2 px-2 py-1.5 rounded hover:bg-[#262626] cursor-pointer transition-colors"
                                >
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            checked={selectedSet.has(artifact.key)}
                                            onChange={() => onToggle(artifact.key, !selectedSet.has(artifact.key))}
                                            disabled={isProcessing}
                                            className="w-3.5 h-3.5 rounded border border-white focus:ring-1 focus:ring-gray-600 appearance-none"
                                            style={{
                                                borderWidth: '0.5px',
                                                backgroundColor: selectedSet.has(artifact.key) ? '#262626' : 'transparent',
                                            }}
                                        />
                                        {selectedSet.has(artifact.key) && (
                                            <svg
                                                className="absolute w-2.5 h-2.5 text-white pointer-events-none"
                                                style={{ top: '5.5px', left: '2px' }}
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                            >
                                                <path
                                                    fillRule="evenodd"
                                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-xs text-white">{artifact.label}</span>
                                        <span className="text-[10px] text-gray-500 ml-2">{artifact.description}</span>
                                    </div>
                                    {artifact.slow && (
                                        <span
                                            className="text-[10px] font-medium px-1.5 py-0 rounded border border-white"
                                            style={{ borderWidth: '0.5px', backgroundColor: '#262626', color: 'white' }}
                                        >
                                            Slow
                                        </span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
