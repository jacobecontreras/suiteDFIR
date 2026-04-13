import { useState, useEffect, useRef, useCallback, RefObject } from 'react';

interface UseDragScrollReturn {
    // Refs to attach to DOM elements
    scrollContainerRef: RefObject<HTMLDivElement | null>;
    scrollbarRef: RefObject<HTMLDivElement | null>;

    // Drag-to-scroll state and handlers
    isDragging: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
    onMouseUp: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;

    // Custom scrollbar state and handlers
    scrollProgress: number;  // 0-1
    thumbWidth: number;      // percentage
    isScrollbarDragging: boolean;
    onScrollbarMouseDown: (e: React.MouseEvent) => void;
    onScrollbarTrackClick: (e: React.MouseEvent) => void;
}

/**
 * Custom hook for drag-to-scroll functionality with custom scrollbar
 *
 * @param dependencies - Array of dependencies that trigger scroll recalculation when changed
 * @param dragThreshold - Optional pixel threshold to distinguish clicks from drags (default: 5)
 */
export function useDragScroll(
    dependencies: unknown[] = [],
    dragThreshold: number = 5
): UseDragScrollReturn {
    // Refs
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const scrollbarRef = useRef<HTMLDivElement>(null);
    const thumbOffsetRef = useRef(0);
    const dragDistanceRef = useRef(0);

    // Drag-to-scroll state
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);

    // Custom scrollbar state
    const [scrollProgress, setScrollProgress] = useState(0);
    const [thumbWidth, setThumbWidth] = useState(20);
    const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);

    // Track scroll position for custom scrollbar
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const updateScrollProgress = () => {
            const maxScroll = container.scrollWidth - container.clientWidth;
            if (maxScroll > 0) {
                setScrollProgress(container.scrollLeft / maxScroll);
                setThumbWidth(Math.max(20, (container.clientWidth / container.scrollWidth) * 100));
            } else {
                setScrollProgress(0);
                setThumbWidth(100);
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            updateScrollProgress();
        });

        resizeObserver.observe(container);

        const content = container.firstElementChild;
        if (content) {
            resizeObserver.observe(content);
        }

        container.addEventListener('scroll', updateScrollProgress);
        updateScrollProgress();

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', updateScrollProgress);
        };
    }, dependencies);

    // Scrollbar drag handling
    useEffect(() => {
        if (!isScrollbarDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!scrollContainerRef.current || !scrollbarRef.current) return;

            const rect = scrollbarRef.current.getBoundingClientRect();
            const trackWidth = rect.width;
            const thumbWidthPx = (thumbWidth / 100) * trackWidth;
            const maxThumbLeft = trackWidth - thumbWidthPx;

            const cursorPositionInTrack = e.clientX - rect.left;
            const targetThumbLeft = cursorPositionInTrack - thumbOffsetRef.current;

            const clampedThumbLeft = Math.max(0, Math.min(maxThumbLeft, targetThumbLeft));

            const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth;
            const scrollPercentage = maxThumbLeft > 0 ? clampedThumbLeft / maxThumbLeft : 0;
            scrollContainerRef.current.scrollLeft = scrollPercentage * maxScroll;
        };

        const handleMouseUp = () => {
            setIsScrollbarDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isScrollbarDragging, thumbWidth]);

    // Drag-to-scroll handlers
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (!scrollContainerRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
        setScrollLeft(scrollContainerRef.current.scrollLeft);
        dragDistanceRef.current = 0;
    }, []);

    const onMouseLeave = useCallback((e: React.MouseEvent) => {
        setIsDragging(false);
        dragDistanceRef.current = 0;
    }, []);

    const onMouseUp = useCallback((e: React.MouseEvent) => {
        // If drag distance is below threshold, this is a click, let it propagate
        if (dragDistanceRef.current < dragThreshold) {
            // Allow normal click behavior
        }
        setIsDragging(false);
        dragDistanceRef.current = 0;
    }, [dragThreshold]);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !scrollContainerRef.current) return;
        e.preventDefault();
        const x = e.pageX - scrollContainerRef.current.offsetLeft;
        const walk = (x - startX) * 1.5;
        scrollContainerRef.current.scrollLeft = scrollLeft - walk;
        dragDistanceRef.current += Math.abs(walk);
    }, [isDragging, startX, scrollLeft]);

    // Scrollbar thumb drag handler
    const onScrollbarMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (!scrollbarRef.current) return;

        const rect = scrollbarRef.current.getBoundingClientRect();
        const thumbLeftPercent = scrollProgress * (100 - thumbWidth);
        const thumbLeftPx = (thumbLeftPercent / 100) * rect.width;
        const clickPositionInTrack = e.clientX - rect.left;
        thumbOffsetRef.current = clickPositionInTrack - thumbLeftPx;

        setIsScrollbarDragging(true);
    }, [scrollProgress, thumbWidth]);

    // Scrollbar track click handler
    const onScrollbarTrackClick = useCallback((e: React.MouseEvent) => {
        if (!scrollContainerRef.current || !scrollbarRef.current) return;
        const rect = scrollbarRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth;
        scrollContainerRef.current.scrollLeft = percentage * maxScroll;
    }, []);

    return {
        scrollContainerRef,
        scrollbarRef,
        isDragging,
        onMouseDown,
        onMouseLeave,
        onMouseUp,
        onMouseMove,
        scrollProgress,
        thumbWidth,
        isScrollbarDragging,
        onScrollbarMouseDown,
        onScrollbarTrackClick,
    };
}
