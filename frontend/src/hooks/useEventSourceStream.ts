import { useRef, useCallback, useEffect } from 'react';

export interface EventSourceStreamHandlers {
    onMessage: (event: MessageEvent<string>) => void;
    onError?: (event: Event) => void;
    onClose?: () => void;
}

export interface EventSourceStreamController<TKey extends string | number = string> {
    connect: (key: TKey, source: EventSource, handlers: EventSourceStreamHandlers) => EventSource;
    disconnect: (key: TKey) => void;
    disconnectAll: () => void;
    hasConnection: (key: TKey) => boolean;
}

export function useEventSourceStream<TKey extends string | number = string>(): EventSourceStreamController<TKey> {
    const connectionsRef = useRef<Map<TKey, EventSource>>(new Map());

    const disconnect = useCallback((key: TKey) => {
        const es = connectionsRef.current.get(key);
        if (es) {
            es.close();
            connectionsRef.current.delete(key);
        }
    }, []);

    const disconnectAll = useCallback(() => {
        connectionsRef.current.forEach(es => es.close());
        connectionsRef.current.clear();
    }, []);

    const connect = useCallback((key: TKey, source: EventSource, handlers: EventSourceStreamHandlers) => {
        // Close existing connection for this key
        const existing = connectionsRef.current.get(key);
        if (existing) {
            existing.close();
            connectionsRef.current.delete(key);
        }

        connectionsRef.current.set(key, source);

        source.onmessage = handlers.onMessage;

        source.addEventListener('close', () => {
            source.close();
            connectionsRef.current.delete(key);
            handlers.onClose?.();
        });

        source.onerror = (event: Event) => {
            source.close();
            connectionsRef.current.delete(key);
            handlers.onError?.(event);
        };

        return source;
    }, []);

    const hasConnection = useCallback((key: TKey) => {
        return connectionsRef.current.has(key);
    }, []);

    // Cleanup all on unmount
    useEffect(() => {
        return () => {
            connectionsRef.current.forEach(es => es.close());
            connectionsRef.current.clear();
        };
    }, []);

    return { connect, disconnect, disconnectAll, hasConnection };
}
