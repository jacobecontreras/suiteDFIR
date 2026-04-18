import { MapPin, Camera, Calendar, FileText, Layers, Star } from 'lucide-react'
import type { PhotoMetadata } from '@/types/photos'
import { METERING_MODES, WHITE_BALANCE_MODES } from '@/types/photos'

interface PhotoMetadataPanelProps {
    metadata?: PhotoMetadata
    score?: number | null
}

function MetadataSection({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-gray-500" />
                <h3 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{title}</h3>
            </div>
            <div className="space-y-1.5 pl-5.5">{children}</div>
        </div>
    )
}

function MetadataRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
    if (value === null || value === undefined) return null
    const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    return (
        <div className="flex justify-between items-baseline">
            <span className="text-[11px] text-gray-500">{label}</span>
            <span className="text-[11px] text-gray-300 text-right max-w-[60%] truncate">{display}</span>
        </div>
    )
}

export function PhotoMetadataPanel({ metadata, score }: PhotoMetadataPanelProps) {
    if (!metadata) {
        return (
            <div className="p-4 text-sm text-gray-600">
                No metadata available
            </div>
        )
    }

    const hasDimensions = metadata.width || metadata.height
    const hasOrigDimensions = metadata.original_width || metadata.original_height

    return (
        <div className="p-4 space-y-5">
            <h2 className="text-sm font-medium text-gray-200">Details</h2>

            {/* Search score */}
            {score !== null && score !== undefined && (
                <div className="px-3 py-2 rounded bg-white/5 border border-white/10">
                    <span className="text-[11px] text-gray-300">
                        Match Score: {(score * 100).toFixed(1)}%
                    </span>
                </div>
            )}

            {/* General */}
            <MetadataSection icon={FileText} title="General">
                <MetadataRow label="Filename" value={metadata.original_filename} />
                <MetadataRow label="Type" value={metadata.media_type} />
                {hasDimensions && (
                    <MetadataRow label="Dimensions" value={`${metadata.width} x ${metadata.height}`} />
                )}
                {hasOrigDimensions && (
                    <MetadataRow label="Original Size" value={`${metadata.original_width} x ${metadata.original_height}`} />
                )}
                {metadata.duration !== undefined && metadata.duration !== null && (
                    <MetadataRow label="Duration" value={`${metadata.duration}s`} />
                )}
            </MetadataSection>

            {/* Dates */}
            {(metadata.date_created || metadata.date_modified) && (
                <MetadataSection icon={Calendar} title="Dates">
                    <MetadataRow label="Created" value={metadata.date_created} />
                    <MetadataRow label="Modified" value={metadata.date_modified} />
                </MetadataSection>
            )}

            {/* Location */}
            {(metadata.latitude !== null && metadata.latitude !== undefined) && (
                <MetadataSection icon={MapPin} title="Location">
                    <div className="flex justify-between items-baseline">
                        <span className="text-[11px] text-gray-500">Coordinates</span>
                        <a
                            href={`https://www.google.com/maps?q=${metadata.latitude},${metadata.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-gray-300 hover:text-gray-100 transition-colors"
                        >
                            {metadata.latitude?.toFixed(6)}, {metadata.longitude?.toFixed(6)}
                        </a>
                    </div>
                </MetadataSection>
            )}

            {/* Camera */}
            {(metadata.camera_make || metadata.camera_model || metadata.iso) && (
                <MetadataSection icon={Camera} title="Camera">
                    <MetadataRow label="Make" value={metadata.camera_make} />
                    <MetadataRow label="Model" value={metadata.camera_model} />
                    <MetadataRow label="Lens" value={metadata.lens_model} />
                    <MetadataRow label="ISO" value={metadata.iso} />
                    <MetadataRow label="Aperture" value={metadata.aperture} />
                    <MetadataRow label="Focal Length" value={metadata.focal_length} />
                    <MetadataRow label="Shutter Speed" value={metadata.shutter_speed} />
                    <MetadataRow label="Flash" value={metadata.flash_fired} />
                    {metadata.metering_mode !== null && metadata.metering_mode !== undefined && (
                        <MetadataRow label="Metering" value={METERING_MODES[metadata.metering_mode] ?? String(metadata.metering_mode)} />
                    )}
                    {metadata.white_balance !== null && metadata.white_balance !== undefined && (
                        <MetadataRow label="White Balance" value={WHITE_BALANCE_MODES[metadata.white_balance] ?? String(metadata.white_balance)} />
                    )}
                </MetadataSection>
            )}

            {/* Status */}
            {(metadata.favorite !== null || metadata.hidden !== null || metadata.trashed !== null) && (
                <MetadataSection icon={Star} title="Status">
                    <MetadataRow label="Favorite" value={metadata.favorite} />
                    <MetadataRow label="Hidden" value={metadata.hidden} />
                    <MetadataRow label="Trashed" value={metadata.trashed} />
                </MetadataSection>
            )}

            {/* Source */}
            {(metadata.domain || metadata.relative_path || metadata.classification) && (
                <MetadataSection icon={Layers} title="Source">
                    <MetadataRow label="Classification" value={
                        metadata.classification === 'original' ? 'Original' :
                        metadata.classification === 'derivative' ? 'Derivative' : undefined
                    } />
                    <MetadataRow label="Domain" value={metadata.domain} />
                    {metadata.relative_path && (
                        <div className="text-[11px] text-gray-500 break-all leading-relaxed">
                            {metadata.relative_path}
                        </div>
                    )}
                </MetadataSection>
            )}
        </div>
    )
}
