export const MAX_SPATIAL_IMPORT_FILES = 10
export const MAX_SPATIAL_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const MAX_SPATIAL_TOTAL_SIZE_BYTES = 50 * 1024 * 1024
export const MAX_SPATIAL_FEATURES = 15000

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
