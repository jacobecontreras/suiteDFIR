import { useRef, useEffect, useState } from 'react';

export function useAutoScroll(logs: string[], enabled: boolean) {
  const logsRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const previousScrollTop = useRef(0);

  useEffect(() => {
    if (logs.length > 0 && logsRef.current && shouldAutoScroll && enabled) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, shouldAutoScroll, enabled]);

  const handleScroll = () => {
    const container = logsRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const currentScrollTop = scrollTop;
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
    const isScrollingUp = currentScrollTop < previousScrollTop.current;
    const isScrollingDown = currentScrollTop > previousScrollTop.current;

    previousScrollTop.current = currentScrollTop;

    if (isScrollingUp) {
      setShouldAutoScroll(false);
      setUserScrolledUp(true);
      return;
    }

    if (isScrollingDown && isAtBottom && userScrolledUp) {
      setShouldAutoScroll(true);
      setUserScrolledUp(false);
      return;
    }

    if (isAtBottom && !userScrolledUp) {
      setShouldAutoScroll(true);
    }
  };

  const resetAutoScroll = () => {
    setShouldAutoScroll(true);
    setUserScrolledUp(false);
    previousScrollTop.current = 0;
  };

  return {
    logsRef,
    handleScroll,
    shouldAutoScroll,
    resetAutoScroll,
    setShouldAutoScroll,
  };
}
