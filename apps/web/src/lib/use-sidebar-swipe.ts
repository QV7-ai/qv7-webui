import { useEffect, useRef } from "react";

const EDGE = 32;
const THRESHOLD = 64;

export function useSidebarSwipe(input: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  enabled?: boolean;
}) {
  const openRef = useRef(input.open);
  const onOpenRef = useRef(input.onOpen);
  const onCloseRef = useRef(input.onClose);
  openRef.current = input.open;
  onOpenRef.current = input.onOpen;
  onCloseRef.current = input.onClose;
  const enabled = input.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function isField(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    }

    function onStart(event: TouchEvent) {
      if (event.touches.length !== 1 || isField(event.target)) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = openRef.current || startX <= EDGE;
    }

    function onMove(event: TouchEvent) {
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dy) > 36 && Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
        return;
      }
      if (!openRef.current && dx > THRESHOLD) {
        onOpenRef.current();
        tracking = false;
      } else if (openRef.current && dx < -THRESHOLD) {
        onCloseRef.current();
        tracking = false;
      }
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
    };
  }, [enabled]);
}
