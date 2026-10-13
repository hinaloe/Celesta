'use client';

import { useEffect, useRef } from 'react';

const fps = 30;

/** `hh:mm:ss:ff` at 30 fps. */
function formatTimecode(frame: number) {
  const seconds = Math.floor(frame / fps);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frame % fps].map(part => String(part).padStart(2, '0')).join(':');
}

/** A running 30 fps timecode; it stays at zero for visitors who prefer reduced motion. */
export function Timecode() {
  const output = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    let request = 0;
    const tick = (now: number) => {
      if (output.current) output.current.textContent = formatTimecode(Math.floor((now - start) * fps / 1000));
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, []);
  return <span ref={output}>{formatTimecode(0)}</span>;
}
