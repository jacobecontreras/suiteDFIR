export const TEST_BACKEND_URL = 'http://localhost:8000'

export const apiUrl = (path: string) =>
    `${TEST_BACKEND_URL}/api${path.startsWith('/') ? path : '/' + path}`
