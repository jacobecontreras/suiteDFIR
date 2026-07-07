import { http, HttpResponse } from 'msw'
import { apiUrl } from './base'

export const backupsHandlers = [
    http.get(apiUrl('/backups/devices'), () => HttpResponse.json([])),
    http.get(apiUrl('/backups'), () => HttpResponse.json([])),
    http.post(apiUrl('/backups'), () => HttpResponse.json({ backup_id: 1 })),
    http.delete(apiUrl('/backups/:id'), () => HttpResponse.json({ message: 'ok' })),
]
