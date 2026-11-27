import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Scale factor that makes an element's natural size fit inside the window (never enlarges). */
export function useFitScale(ref: RefObject<HTMLElement | null>, padY = 48, padX = 32) {
  const [s, setS] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setS(Math.min(1, (window.innerHeight - padY) / el.scrollHeight, (window.innerWidth - padX) / el.scrollWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  return s;
}

/** The HUD is laid out on a design canvas at least 1440 × 860 px and scaled uniformly to the
 *  window, so panels never overlap on shorter or narrower screens. The 3D map is not scaled. */
export const HUD_MIN_W = 1440;
export const HUD_MIN_H = 860;

export function useHudCanvas() {
  const get = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.min(1, w / HUD_MIN_W, h / HUD_MIN_H);
    return { s, w: w / s, h: h / s };
  };
  const [c, setC] = useState(get);
  useEffect(() => {
    const on = () => setC(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return c;
}
