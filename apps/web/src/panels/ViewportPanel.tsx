/**
 * Viewport panel (§B.1): hosts `RigScene` inside the dock.
 *
 * The delicate parts, in order of how easily they break:
 *
 * 1. **The WebGL context must survive.** The scene is created once on mount and
 *    disposed only on unmount. Nothing in the render path touches React state
 *    per frame, and the effect that owns the scene has an empty dependency list
 *    so a parent re-render cannot recreate it (§B.1.4).
 * 2. **Resize comes from the panel, not the window.** A `ResizeObserver` on the
 *    content element is the only correct source: dock panels resize constantly
 *    while the window does not.
 * 3. **Toggles are pushed imperatively.** Zustand state feeds the scene through
 *    an effect rather than re-rendering anything, so flipping "Grid" costs one
 *    property write, not a React tree diff.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn, Tooltip } from '@wms/ui';

import { RigScene, type ViewSnapName } from '../features/rig/RigScene';
import { hasEstimatedTwist } from '../features/rig/rigSkeleton';
import { useEditorStore, type ViewportToggleKey } from '../state/useEditorStore';
import { useSelection } from '../state/useSelection';

interface OverlayToggle {
  key: ViewportToggleKey;
  label: string;
  glyph: string;
  /** Present but inert until a later document. */
  pending?: string;
}

const OVERLAY_TOGGLES: OverlayToggle[] = [
  { key: 'grid', label: 'Grid', glyph: '▦' },
  { key: 'worldAxes', label: 'World axes', glyph: '⊹' },
  { key: 'navGizmo', label: 'Navigation gizmo', glyph: '◈' },
  { key: 'skeleton', label: 'Joints & bones', glyph: '⦿' },
  { key: 'capsuleBody', label: 'Capsule body', glyph: '⬭' },
  { key: 'jointTrails', label: 'Joint trails', glyph: '〜', pending: 'Arrives in Document 4' },
  { key: 'cameraFrustum', label: 'Camera frustum', glyph: '▱' },
  { key: 'stats', label: 'Stats readout', glyph: '⌗' },
];

/** Keyboard view snaps (§B.1.1). Ctrl/Cmd gives the opposite side. */
const VIEW_SNAP_KEYS: Record<string, { plain: ViewSnapName; opposite: ViewSnapName }> = {
  '1': { plain: 'front', opposite: 'back' },
  '3': { plain: 'right', opposite: 'left' },
  '7': { plain: 'top', opposite: 'bottom' },
};

export function ViewportPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RigScene | null>(null);
  const [ready, setReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [stats, setStats] = useState({ fps: 0, drawCalls: 0 });

  const toggles = useEditorStore((s) => s.viewport);
  const toggleViewport = useEditorStore((s) => s.toggleViewport);
  const cameraMode = useEditorStore((s) => s.cameraMode);
  const setCameraMode = useEditorStore((s) => s.setCameraMode);
  const cameraCommand = useEditorStore((s) => s.cameraCommand);
  const selectedJointName = useSelection((s) => s.selectedJointName);
  const select = useSelection((s) => s.select);

  // Latest toggles, readable from the rAF loop without re-subscribing it.
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;

  // ---- scene lifecycle: created once, destroyed once ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    let scene: RigScene;
    try {
      scene = new RigScene({ canvas });
    } catch (error) {
      // A machine with no WebGL should show an empty state, not a blank panel.
      console.error('[viewport] could not create a WebGL context', error);
      setContextLost(true);
      return;
    }
    sceneRef.current = scene;
    setReady(true);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // Resize from the panel's own box. `ResizeObserver` also fires once on
    // observe, which gives us the initial size for free.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      scene.resize(width, height);
    });
    observer.observe(host);

    let frame = 0;
    let lastStatsAt = performance.now();
    let framesSinceStats = 0;

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      scene.render(now, togglesRef.current.navGizmo);

      framesSinceStats += 1;
      if (now - lastStatsAt >= 500) {
        const fps = (framesSinceStats * 1000) / (now - lastStatsAt);
        // Throttled to 2Hz: this is the only per-frame React state write in the
        // panel, and at 60fps an unthrottled one would dominate the frame budget.
        setStats({ fps, drawCalls: scene.drawCalls });
        framesSinceStats = 0;
        lastStatsAt = now;
      }
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      // Teardown must never throw into React's commit phase: an error escaping
      // here unwinds the whole tree and blanks the entire app, not just this
      // panel. Releasing GPU resources is best-effort by nature.
      try {
        scene.dispose();
      } catch (error) {
        console.error('[viewport] scene teardown failed', error);
      }
      sceneRef.current = null;
    };
  }, []);

  // ---- push display toggles into the scene ----
  useEffect(() => {
    sceneRef.current?.setToggles(toggles);
  }, [toggles]);

  // ---- selection drives the transform gizmo scaffold ----
  useEffect(() => {
    sceneRef.current?.setSelection(selectedJointName);
  }, [selectedJointName]);

  // ---- one-shot camera commands from the View menu ----
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !cameraCommand.action) return;
    switch (cameraCommand.action) {
      case 'reset':
        scene.resetCamera();
        break;
      case 'frameAll':
        scene.frameAll();
        break;
      case 'frameSelected':
        if (selectedJointName) scene.frameJoint(selectedJointName);
        else scene.frameAll();
        break;
    }
    // `nonce` is the dependency that matters: it makes repeated identical
    // commands distinct events.
  }, [cameraCommand.nonce, cameraCommand.action, selectedJointName]);

  // ---- keyboard: view snaps and Frame Selected ----
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const snap = VIEW_SNAP_KEYS[event.key];
      if (snap) {
        event.preventDefault();
        scene.snapToView(event.ctrlKey || event.metaKey ? snap.opposite : snap.plain);
        return;
      }
      if (event.key === '.') {
        event.preventDefault();
        if (selectedJointName) scene.frameJoint(selectedJointName);
        else scene.frameAll();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        // Stubbed per §B.1.1 — the real transform needs Document 5's calibration.
        useEditorStore.getState().setViewportToggle('cameraFrustum', true);
      }
    },
    [selectedJointName],
  );

  // ---- pointer: nav-gizmo handles first, then joint picking ----
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const scene = sceneRef.current;
      const host = hostRef.current;
      if (!scene || !host) return;

      const rect = host.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      if (togglesRef.current.navGizmo) {
        const gizmo = scene.navGizmoRect(rect.width, rect.height);
        const insideGizmo =
          localX >= gizmo.x &&
          localX <= gizmo.x + gizmo.size &&
          localY >= gizmo.y &&
          localY <= gizmo.y + gizmo.size;
        if (insideGizmo) {
          // Re-project into the gizmo's own NDC space, not the main viewport's.
          const gx = ((localX - gizmo.x) / gizmo.size) * 2 - 1;
          const gy = -(((localY - gizmo.y) / gizmo.size) * 2 - 1);
          const snap = scene.pickNavGizmo(gx, gy);
          if (snap) {
            event.stopPropagation();
            scene.snapToView(snap);
            return;
          }
        }
      }

      // Dev-only click-to-select, exercising the selection + gizmo plumbing
      // (§B.1.2). Document 4 replaces this with real selection behaviour.
      if (import.meta.env.DEV) {
        const ndcX = (localX / rect.width) * 2 - 1;
        const ndcY = -((localY / rect.height) * 2 - 1);
        const joint = scene.pickJoint(ndcX, ndcY);
        if (joint) select(joint);
      }
    },
    [select],
  );

  return (
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
       role="application" makes this a deliberate focusable keyboard surface (the
       view-snap keys need focus to land here); the rule does not model that role. */
    <div
      ref={hostRef}
      // `application` is the honest role for a 3D viewport: it tells assistive
      // technology to pass keystrokes straight through rather than interpreting
      // them as browse-mode navigation, which is exactly what the view-snap keys
      // need.
      role="application"
      aria-label="3D viewport"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="viewport-panel"
      /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
      className={cn(
        'relative h-full w-full overflow-hidden bg-surface-light outline-none dark:bg-surface-dark',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
      )}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        className="block h-full w-full touch-none"
        data-testid="viewport-canvas"
      />

      <ViewportOverlayToolbar
        toggles={toggles}
        onToggle={toggleViewport}
        cameraMode={cameraMode}
        onCameraMode={setCameraMode}
      />

      {toggles.stats && ready && !contextLost && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/55 px-2 py-1 font-mono text-[10px] leading-tight text-white backdrop-blur-sm">
          <div>{stats.fps.toFixed(0)} fps (rig)</div>
          <div>{stats.drawCalls} draws</div>
        </div>
      )}

      {selectedJointName && (
        <div className="pointer-events-none absolute bottom-2 right-2 max-w-[240px] rounded-lg bg-black/55 px-2 py-1 text-[10px] leading-tight text-white backdrop-blur-sm">
          <div className="font-medium">{selectedJointName}</div>
          {hasEstimatedTwist(selectedJointName) && (
            <div className="mt-0.5 text-warning">Twist estimated — see Properties</div>
          )}
        </div>
      )}

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-light/95 p-6 text-center dark:bg-surface-dark/95">
          <div className="max-w-xs">
            <p className="text-[13px] font-medium text-content-light-primary dark:text-content-dark-primary">
              3D view unavailable
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-content-light-secondary dark:text-content-dark-secondary">
              The WebGL context was lost or could not be created. Other panels keep working;
              reload the page to try again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewportOverlayToolbar({
  toggles,
  onToggle,
  cameraMode,
  onCameraMode,
}: {
  toggles: Record<ViewportToggleKey, boolean>;
  onToggle: (key: ViewportToggleKey) => void;
  cameraMode: 'orbit' | 'fly';
  onCameraMode: (mode: 'orbit' | 'fly') => void;
}) {
  return (
    <div
      className={cn(
        'absolute left-2 top-2 flex items-center gap-0.5 rounded-lg p-1',
        'border border-hairline-light bg-white/75 shadow-sm backdrop-blur-xl',
        'dark:border-hairline-dark dark:bg-surface-dark-elevated/75',
      )}
    >
      <div className="flex items-center gap-0.5 pr-1">
        {(['orbit', 'fly'] as const).map((mode) => (
          <Tooltip key={mode} content={mode === 'orbit' ? 'Orbit around a target' : 'Fly (WASD + look)'}>
            <button
              type="button"
              onClick={() => onCameraMode(mode)}
              aria-pressed={cameraMode === mode}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors duration-180 ease-apple-out',
                cameraMode === mode
                  ? 'bg-accent text-white'
                  : 'text-content-light-secondary hover:bg-black/[0.06] dark:text-content-dark-secondary dark:hover:bg-white/[0.08]',
              )}
            >
              {mode}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="h-5 w-px bg-hairline-light dark:bg-hairline-dark" />

      {OVERLAY_TOGGLES.map((item) => {
        const active = toggles[item.key];
        const disabled = Boolean(item.pending);
        return (
          <Tooltip key={item.key} content={item.pending ? `${item.label} — ${item.pending}` : item.label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggle(item.key)}
              aria-pressed={active}
              aria-label={item.label}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md text-[13px] transition-colors duration-180 ease-apple-out',
                active && !disabled
                  ? 'bg-accent/15 text-accent'
                  : 'text-content-light-secondary hover:bg-black/[0.06] dark:text-content-dark-secondary dark:hover:bg-white/[0.08]',
                disabled && 'cursor-not-allowed opacity-35',
              )}
            >
              <span aria-hidden="true">{item.glyph}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
