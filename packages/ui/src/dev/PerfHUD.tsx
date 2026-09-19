import { useEffect, useRef, useState } from 'react';
import { cn } from '../cn';

interface PerfSample {
  fps: number;
  p90FrameMs: number;
  heapMb: number | null;
}

interface MemoryInfo {
  usedJSHeapSize: number;
}

/**
 * Dev-only performance overlay. Toggle with Cmd/Ctrl+Shift+P.
 * Later phases can feed worker-reported stats into the `extra` slot.
 */
export function PerfHUD({
  defaultVisible = false,
  extra,
  className,
}: {
  defaultVisible?: boolean;
  extra?: React.ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(defaultVisible);
  const [sample, setSample] = useState<PerfSample>({ fps: 0, p90FrameMs: 0, heapMb: null });
  const frames = useRef<number[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let last = performance.now();
    let lastReport = last;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      frames.current.push(dt);
      if (frames.current.length > 180) frames.current.shift();

      if (now - lastReport > 500 && frames.current.length > 1) {
        lastReport = now;
        const sorted = [...frames.current].sort((a, b) => a - b);
        const mean = frames.current.reduce((a, b) => a + b, 0) / frames.current.length;
        const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? mean;
        const mem = (performance as Performance & { memory?: MemoryInfo }).memory;
        setSample({
          fps: mean > 0 ? 1000 / mean : 0,
          p90FrameMs: p90,
          heapMb: mem ? mem.usedJSHeapSize / 1024 / 1024 : null,
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  const tone =
    sample.fps >= 55 ? 'text-success' : sample.fps >= 30 ? 'text-warning' : 'text-danger';

  return (
    <div
      data-testid="perf-hud"
      className={cn(
        'pointer-events-none fixed bottom-12 left-4 z-[90] min-w-[168px] rounded-xl p-3',
        'bg-neutral-900/80 font-mono text-[11px] leading-relaxed text-white backdrop-blur-md shadow-panel',
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-4 font-sans text-[10px] uppercase tracking-wider text-white/50">
        <span>Perf</span>
        <span>⌘⇧P</span>
      </div>
      <div className={tone}>{sample.fps.toFixed(1)} fps</div>
      <div className="text-white/70">p90 {sample.p90FrameMs.toFixed(1)} ms</div>
      <div className="text-white/70">
        heap {sample.heapMb === null ? 'n/a' : `${sample.heapMb.toFixed(0)} MB`}
      </div>
      {extra}
    </div>
  );
}
