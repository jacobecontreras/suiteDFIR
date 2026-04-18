export interface PhotoExtraction {
    id: number
    case_id: number
    backup_id: number
    device_name: string
    output_path: string
    image_count: number
    indexed: boolean
    status: string
    created_at: string
}

export interface PhotoMetadata {
    date_created?: string
    date_modified?: string
    latitude?: number
    longitude?: number
    media_type?: string
    duration?: number
    camera_make?: string
    camera_model?: string
    lens_model?: string
    iso?: number
    aperture?: number
    focal_length?: number
    shutter_speed?: number
    flash_fired?: boolean
    metering_mode?: number
    white_balance?: number
    width?: number
    height?: number
    original_width?: number
    original_height?: number
    favorite?: boolean
    hidden?: boolean
    trashed?: boolean
    original_filename?: string
    domain?: string
    relative_path?: string
    classification?: 'original' | 'derivative'
}

export const METERING_MODES: Record<number, string> = {
    0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot',
    4: 'Multi-spot', 5: 'Pattern', 6: 'Partial',
}

export const WHITE_BALANCE_MODES: Record<number, string> = {
    0: 'Auto', 1: 'Manual',
}

export interface PhotoItem {
    file_id: string
    thumbnail_url: string
    full_url: string
    metadata?: PhotoMetadata
}

export interface PhotoSearchResult extends PhotoItem {
    score: number
}

export type PhotoSort = 'newest' | 'oldest' | 'relevance'

export type ForensicFilter =
    | 'weapons'
    | 'drugs'
    | 'currency'
    | 'documents'
    | 'vehicles'
    | 'screenshots'
    | 'faces'
    | 'locations'

export const FORENSIC_FILTER_QUERIES: Record<ForensicFilter, string> = {
    weapons: 'gun firearm knife weapon ammunition rifle pistol sword handgun',
    drugs: 'drugs narcotics pills marijuana cocaine powder substance paraphernalia',
    currency: 'cash money currency banknotes bills coins credit card',
    documents: 'document identification passport drivers license ID card paperwork',
    vehicles: 'car vehicle automobile truck license plate motorcycle',
    screenshots: 'screenshot phone screen computer screen text message notification',
    faces: 'person face portrait selfie headshot people',
    locations: 'map location address building house street sign landmark',
}

export interface PhotoFilters {
    mediaType?: string
    hasGps?: boolean
    dateFrom?: string
    dateTo?: string
    classification?: 'original' | 'derivative'
}
