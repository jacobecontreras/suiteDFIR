export const MAX_SPATIAL_IMPORT_FILES = 10
export const MAX_SPATIAL_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const MAX_SPATIAL_TOTAL_SIZE_BYTES = 50 * 1024 * 1024
export const MAX_SPATIAL_FEATURES = 15000

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
