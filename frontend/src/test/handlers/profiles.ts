import { http, HttpResponse } from 'msw'
import { apiUrl } from './base'

export const profilesHandlers = [
    http.get(apiUrl('/profiles'), () => HttpResponse.json([])),
    http.post(apiUrl('/profiles'), () => HttpResponse.json({ name: 'unnamed' })),
    http.post(apiUrl('/profiles/:id/load'), () =>
        HttpResponse.json({ message: 'ok', modules: [] }),
    ),
    http.delete(apiUrl('/profiles/:id'), () => HttpResponse.json({ message: 'ok' })),
]
