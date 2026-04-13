
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { initBackendUrl } from '@/lib/api';

interface APIContextType {
    backendUrl: string;
    isReady: boolean;
}

const APIContext = createContext<APIContextType>({
    backendUrl: 'http://localhost:8000',
    isReady: false
});

export function useAPI() {
    return useContext(APIContext);
}

interface APIProviderProps {
    children: ReactNode;
}

/**
 * Provider that initializes the backend URL on app startup
 * Wraps the app to ensure API is ready before child components render fetches
 */
import { LoadingPage } from "@/components/ui/LoadingPage";

export function APIProvider({ children }: APIProviderProps) {
    const [isReady, setIsReady] = useState(false);
    const [backendUrl, setBackendUrl] = useState('http://localhost:8000');

    useEffect(() => {
        initBackendUrl().then((url) => {
            setBackendUrl(url);
            setIsReady(true);
        });
    }, []);

    if (!isReady) {
        return <LoadingPage />;
    }

    return (
        <APIContext.Provider value={{ backendUrl, isReady }}>
            {children}
        </APIContext.Provider>
    );
}
