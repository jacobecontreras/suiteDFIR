import { casesHandlers } from './cases'
import { leappHandlers } from './leapp'
import { backupsHandlers } from './backups'
import { photosHandlers } from './photos'
import { profilesHandlers } from './profiles'

export const handlers = [
    ...casesHandlers,
    ...leappHandlers,
    ...backupsHandlers,
    ...photosHandlers,
    ...profilesHandlers,
]

export { TEST_BACKEND_URL } from './base'
