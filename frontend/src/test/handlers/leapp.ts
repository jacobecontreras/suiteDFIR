import { http, HttpResponse } from 'msw'
import { apiUrl } from './base'

export const leappHandlers = [
    http.get(apiUrl('/profiles/modules'), () => HttpResponse.json({ modules: [] })),
    http.post(apiUrl('/profiles/modules/select'), () => HttpResponse.json({})),
    http.post(apiUrl('/process/start'), () => HttpResponse.json({ task_id: 'task-1' })),
    http.post(apiUrl('/process/stop'), () => HttpResponse.json({})),
    http.post(apiUrl('/browse-files'), () =>
        HttpResponse.json({ success: true, file_path: '/tmp/file.zip' }),
    ),
    http.post(apiUrl('/browse-folders'), () =>
        HttpResponse.json({ success: true, file_path: '/tmp/out' }),
    ),
    http.post(apiUrl('/backups/validate'), () =>
        HttpResponse.json({ encrypted: false, valid: true }),
    ),
]
