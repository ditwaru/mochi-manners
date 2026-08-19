import { useLayoutEffect } from "react";

export function useScrollToTop() {
  useLayoutEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    };

    resetScroll();
    const frame = window.requestAnimationFrame(resetScroll);

    return () => window.cancelAnimationFrame(frame);
  }, []);
}
