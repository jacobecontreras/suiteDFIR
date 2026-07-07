import { http, HttpResponse } from 'msw'
import { apiUrl } from './base'

export const photosHandlers = [
    http.get(apiUrl('/photos/extractions'), () => HttpResponse.json([])),
    http.get(apiUrl('/photos/extractions/:id/photos'), () =>
        HttpResponse.json({ photos: [], total: 0 }),
    ),
    http.post(apiUrl('/photos/extractions/:id/search'), () =>
        HttpResponse.json({ results: [] }),
    ),
]
