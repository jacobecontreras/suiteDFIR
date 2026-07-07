/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            globals: true,
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.ts'],
            css: false,
            include: ['src/**/*.{test,spec}.{ts,tsx}'],
            exclude: ['node_modules', 'dist'],
            coverage: {
                provider: 'v8',
                reporter: ['text', 'html', 'json-summary'],
                include: ['src/lib/**', 'src/hooks/**', 'src/context/**', 'src/components/**'],
                exclude: [
                    'src/components/ui/**',
                    'src/components/cases/PhoneMockup.tsx',
                    'src/**/*.d.ts',
                    'src/test/**',
                    'src/main.tsx',
                    'src/App.tsx',
                    'src/pages/**',
                    'src/layouts/**',
                ],
                // Per-file thresholds only on what's actually covered by this
                // test suite. Untested files still appear in the coverage
                // report but don't fail the build.
                thresholds: {
                    'src/lib/**': { lines: 80, branches: 70, functions: 80, statements: 80 },
                    'src/hooks/useBackupProcessing.ts': { lines: 80, branches: 70, functions: 80, statements: 80 },
                    'src/hooks/useLeappProcessing.ts': { lines: 80, branches: 75, functions: 80, statements: 80 },
                    'src/hooks/useEventSourceStream.ts': { lines: 85, branches: 70, functions: 80, statements: 85 },
                    'src/hooks/usePhotosSearch.ts': { lines: 90, branches: 65, functions: 90, statements: 90 },
                    'src/hooks/usePhotosExtraction.ts': { lines: 90, branches: 80, functions: 80, statements: 90 },
                    'src/hooks/usePersistedState.ts': { lines: 90, branches: 80, functions: 90, statements: 90 },
                    'src/hooks/useCasePersistedState.ts': { lines: 90, branches: 60, functions: 90, statements: 90 },
                    'src/context/CaseContext.tsx': { lines: 90, branches: 70, functions: 90, statements: 90 },
                },
            },
        },
    }),
)
