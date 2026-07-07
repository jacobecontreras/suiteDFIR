import { http, HttpResponse } from 'msw'
import { apiUrl } from './base'

export const casesHandlers = [
    http.get(apiUrl('/cases'), () => HttpResponse.json([])),
]
