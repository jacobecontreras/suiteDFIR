import { ReactElement, ReactNode } from 'react'
import { render, RenderOptions, RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CaseProvider } from '@/context/CaseContext'

interface RenderOptionsWithRouter extends Omit<RenderOptions, 'wrapper'> {
    initialRoute?: string
    selectedCaseId?: string | null
    withCaseProvider?: boolean
}

export function renderWithProviders(
    ui: ReactElement,
    options: RenderOptionsWithRouter = {},
): RenderResult {
    const {
        initialRoute = '/',
        selectedCaseId = null,
        withCaseProvider = true,
        ...renderOptions
    } = options

    if (selectedCaseId !== null) {
        localStorage.setItem('selectedCaseId', JSON.stringify(selectedCaseId))
    }

    function Wrapper({ children }: { children: ReactNode }) {
        const content = withCaseProvider ? <CaseProvider>{children}</CaseProvider> : children
        return <MemoryRouter initialEntries={[initialRoute]}>{content}</MemoryRouter>
    }

    return render(ui, { wrapper: Wrapper, ...renderOptions })
}

export * from '@testing-library/react'
