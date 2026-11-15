import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type Props = {
  active: boolean;
  primary: ReactNode;
  secondary: ReactNode;
  splitId: string;
};

function initialRatio(key: string, fallback: number) {
  try {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= 15 && stored <= 85 ? stored : fallback;
  } catch {
    return fallback;
  }
}

export default function SplitWorkspace({ active, primary, secondary, splitId }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const wideKey = `orbis-${splitId}-split-ratio-v1`;
  const stackedKey = `orbis-${splitId}-stacked-ratio-v1`;
  const [wideRatio, setWideRatio] = useState(() => initialRatio(wideKey, 50));
  const [stackedRatio, setStackedRatio] = useState(() => initialRatio(stackedKey, 38));
  const wide = size.width >= 760;
  const minRatio = Math.min(50, Math.max(15, (wide ? 289 / Math.max(1, size.width) : 189 / Math.max(1, size.height)) * 100));
  const clamp = (value: number) => Math.max(minRatio, Math.min(100 - minRatio, value));
  const ratio = clamp(wide ? wideRatio : stackedRatio);
  const setRatio = wide ? setWideRatio : setStackedRatio;

  useEffect(() => {
    if (!active || !root.current) return;
    const observer = new ResizeObserver(entries => setSize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height }));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    try {
      localStorage.setItem(wideKey, String(wideRatio));
      localStorage.setItem(stackedKey, String(stackedRatio));
    } catch {
      return;
    }
  }, [wideKey, stackedKey, wideRatio, stackedRatio]);

  if (!active) {
    return <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{primary}</div>;
  }

  function resizeFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = wide
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;
    if (Number.isFinite(fraction)) setRatio(clamp(fraction * 100));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeFromPointer(event);
    event.preventDefault();
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current === event.pointerId) resizeFromPointer(event);
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={root}
      className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
      style={wide
        ? { gridTemplateColumns: `${ratio}% 9px minmax(0, 1fr)` }
        : { gridTemplateRows: `${ratio}% 9px minmax(0, 1fr)` }}
    >
      <div className="relative min-h-0 min-w-0 overflow-hidden">{primary}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={`Resize lunar map and ${splitId === "analysis" ? "3D viewer" : splitId === "statistics" ? "statistics" : "explore panel"}`}
        aria-orientation={wide ? "vertical" : "horizontal"}
        aria-valuemin={Math.ceil(minRatio)}
        aria-valuemax={Math.floor(100 - minRatio)}
        aria-valuenow={Math.round(ratio)}
        title="Drag to resize · Double-click for 50/50"
        className={`group z-20 flex select-none items-center justify-center bg-[#3f3f3f] outline-none hover:bg-[#03ace4]/35 focus-visible:bg-[#03ace4]/35 ${wide ? "cursor-col-resize" : "cursor-row-resize"}`}
        style={{ touchAction: "none" }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={() => { dragging.current = null; }}
        onDoubleClick={() => setRatio(50)}
        onKeyDown={event => {
          const decrease = wide ? event.key === "ArrowLeft" : event.key === "ArrowUp";
          const increase = wide ? event.key === "ArrowRight" : event.key === "ArrowDown";
          if (decrease || increase) {
            event.preventDefault();
            setRatio(current => clamp(current + (decrease ? -5 : 5)));
          } else if (event.key === "Home") {
            event.preventDefault();
            setRatio(minRatio);
          } else if (event.key === "End") {
            event.preventDefault();
            setRatio(100 - minRatio);
          } else if (event.key === "Enter") {
            setRatio(50);
          }
        }}
      >
        <div className={`rounded bg-[#8c959c] group-hover:bg-white ${wide ? "h-10 w-[3px]" : "h-[3px] w-10"}`} />
      </div>
      <div className="relative min-h-0 min-w-0 overflow-hidden">{secondary}</div>
    </div>
  );
}
