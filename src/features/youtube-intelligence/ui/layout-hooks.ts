"use client";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Whether a media query matches; false during server rendering. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The `top` for a sticky panel that may be taller than the viewport. A short
 * panel sticks at `offset`; a tall one gets a negative top so it scrolls with
 * the page until its bottom is in view and then sticks, which keeps every part
 * of it reachable without an internal scroll box. `enabled` re-measures when
 * the panel moves to a new element (for example after a layout change).
 */
export function useStickyTop(
  ref: RefObject<HTMLElement | null>,
  offset: number,
  enabled = true,
  gap = 16,
) {
  const [top, setTop] = useState(offset);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const update = () =>
      setTop(
        Math.min(offset, window.innerHeight - element.offsetHeight - gap),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, offset, enabled, gap]);
  return top;
}
