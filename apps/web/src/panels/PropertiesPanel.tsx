/**
 * Properties / Inspector panel (§B.5).
 *
 * The single home for contextual settings. In a real editor these live in an
 * inspector, not in modals and floating dev overlays, so this panel absorbs
 * three things the earlier documents had scattered elsewhere:
 *
 *   - the One Euro filter sliders (Document 2 §7's "temporary dev overlay"),
 *   - the BVH export options (Document 2 §14's modal dialog),
 *   - the twist-estimation caveat (previously a viewport tooltip).
 *
 * That last one matters for acceptance: a caveat buried in a hover tooltip is
 * not "surfaced in the UI" in any meaningful sense. Here it is a findable,
 * readable section attached to the joints it applies to.
 */

import { useMemo } from 'react';
import { Badge, Button, cn, Slider } from '@wms/ui';

import { hasEstimatedTwist, TWIST_LIMITATION_NOTE } from '../features/rig/rigSkeleton';
import { ONE_EURO_DEFAULTS, useEditorStore } from '../state/useEditorStore';
import { useLiveStore } from '../state/useLiveStore';
import { useSelection } from '../state/useSelection';
import { useWorkspaceStore } from '../state/useWorkspaceStore';

export function PropertiesPanel() {
  const context = useEditorStore((s) => s.propertiesContext);

  return (
    <div className="h-full w-full overflow-auto bg-surface-light-elevated p-3 dark:bg-surface-dark-elevated">
      {context.kind === 'session' && <SessionContext />}
      {context.kind === 'export' && <ExportContext />}
      {context.kind === 'preferences' && <PreferencesContext />}
      {context.kind === 'joint' && <JointContext jointName={context.jointName} />}
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-light-secondary dark:text-content-dark-secondary">
          {title}
        </h3>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-content-light-secondary dark:text-content-dark-secondary">{label}</span>
      <span className="truncate font-mono text-content-light-primary dark:text-content-dark-primary">
        {value}
      </span>
    </div>
  );
}

/** Default context: take settings and the live filter parameters. */
function SessionContext() {
  const source = useLiveStore((s) => s.source);
  const fps = useLiveStore((s) => s.fps);
  const subjectHeight = useEditorStore((s) => s.subjectHeight);
  const setSubjectHeight = useEditorStore((s) => s.setSubjectHeight);
  const filterParams = useEditorStore((s) => s.filterParams);
  const setFilterParam = useEditorStore((s) => s.setFilterParam);
  const resetFilterParams = useEditorStore((s) => s.resetFilterParams);

  const isDefault =
    filterParams.minCutoff === ONE_EURO_DEFAULTS.minCutoff &&
    filterParams.beta === ONE_EURO_DEFAULTS.beta &&
    filterParams.dCutoff === ONE_EURO_DEFAULTS.dCutoff;

  return (
    <>
      <Section title="Source">
        <ReadOnlyRow label="Input" value={source.kind === 'none' ? 'None' : source.label} />
        <ReadOnlyRow
          label="Resolution"
          value={source.width > 0 ? `${source.width}×${source.height}` : '—'}
        />
        <ReadOnlyRow label="Capture rate" value={fps > 0 ? `${fps.toFixed(1)} fps` : '—'} />
      </Section>

      <Section title="Subject">
        <Slider
          label="Height"
          min={1.2}
          max={2.2}
          step={0.01}
          value={subjectHeight}
          displayValue={`${subjectHeight.toFixed(2)} m`}
          onChange={(event) => setSubjectHeight(Number(event.currentTarget.value))}
        />
        <p className="text-[11px] leading-snug text-content-light-secondary dark:text-content-dark-secondary">
          Used to scale the rig to the performer. Applied during Document 3&rsquo;s calibration
          step; collected now so it travels with the take.
        </p>
      </Section>

      <Section
        title="Smoothing (One Euro)"
        action={
          <Button size="sm" variant="ghost" disabled={isDefault} onClick={resetFilterParams}>
            Reset
          </Button>
        }
      >
        <Slider
          label="Min cutoff"
          min={0.1}
          max={5}
          step={0.05}
          value={filterParams.minCutoff}
          displayValue={filterParams.minCutoff.toFixed(2)}
          onChange={(event) => setFilterParam('minCutoff', Number(event.currentTarget.value))}
        />
        <Slider
          label="Beta"
          min={0}
          max={0.05}
          step={0.001}
          value={filterParams.beta}
          displayValue={filterParams.beta.toFixed(3)}
          onChange={(event) => setFilterParam('beta', Number(event.currentTarget.value))}
        />
        <Slider
          label="Derivative cutoff"
          min={0.1}
          max={5}
          step={0.05}
          value={filterParams.dCutoff}
          displayValue={filterParams.dCutoff.toFixed(2)}
          onChange={(event) => setFilterParam('dCutoff', Number(event.currentTarget.value))}
        />
        <p className="text-[11px] leading-snug text-content-light-secondary dark:text-content-dark-secondary">
          Lower <span className="font-mono">min cutoff</span> smooths more but adds lag. Raise{' '}
          <span className="font-mono">beta</span> to let fast motion through.
        </p>
      </Section>
    </>
  );
}

/** Export context, invoked from File → Export ▸ BVH. */
function ExportContext() {
  const frameCount = useLiveStore((s) => s.frameIndex);
  const setContext = useEditorStore((s) => s.setPropertiesContext);

  // 21 joints × 3 rotation channels + 3 root channels, ~9 chars per value.
  const estimatedBytes = useMemo(() => Math.max(frameCount, 1) * (3 + 21 * 3) * 9 + 4096, [frameCount]);
  const estimatedKb = (estimatedBytes / 1024).toFixed(0);

  return (
    <>
      <Section title="Export BVH">
        <ReadOnlyRow label="Frames" value={String(frameCount)} />
        <ReadOnlyRow label="Estimated size" value={`~${estimatedKb} KB`} />
        <label className="flex items-center justify-between gap-3 text-[12px]">
          <span className="text-content-light-secondary dark:text-content-dark-secondary">Units</span>
          <select
            defaultValue="cm"
            className="rounded-md border border-hairline-light bg-transparent px-2 py-1 text-[12px] dark:border-hairline-dark"
          >
            <option value="cm">Centimetres (Blender default)</option>
            <option value="m">Metres</option>
          </select>
        </label>
      </Section>

      <Section title="Importing in Blender">
        <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-content-light-secondary dark:text-content-dark-secondary">
          <li>
            <span className="font-medium">File → Import → Motion Capture (.bvh)</span>
          </li>
          <li>Leave every importer option at its default — no scale or rotation correction.</li>
          <li>The rig should stand upright, ~1.7 m tall, facing away from the front view.</li>
        </ol>
        <p className="text-[11px] leading-snug text-content-light-secondary dark:text-content-dark-secondary">
          If you need a correction to make it look right, that is a bug in our exporter, not a
          setting — please report it.
        </p>
      </Section>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setContext({ kind: 'session' })}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled className="flex-1">
          Export
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-content-light-secondary dark:text-content-dark-secondary">
        Export activates once a take has been recorded.
      </p>
    </>
  );
}

function PreferencesContext() {
  const description = useWorkspaceStore((s) => s.description);
  const setContext = useEditorStore((s) => s.setPropertiesContext);

  return (
    <>
      <Section title="Workspace">
        <p className="text-[12px] leading-snug text-content-light-primary dark:text-content-dark-primary">
          {description || 'No workspace selected yet.'}
        </p>
        <p className="text-[11px] leading-snug text-content-light-secondary dark:text-content-dark-secondary">
          Change it from the Workspace Browser panel.
        </p>
      </Section>

      <Section title="Keyboard shortcuts">
        <dl className="flex flex-col gap-1 text-[11px]">
          {[
            ['1 / 3 / 7', 'Front / Right / Top view'],
            ['Ctrl + 1 / 3 / 7', 'Opposite view'],
            ['.', 'Frame selected (or all)'],
            ['Space', 'Play / pause'],
            ['R', 'Start / stop recording'],
          ].map(([keys, action]) => (
            <div key={keys} className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-content-light-primary dark:text-content-dark-primary">
                {keys}
              </dt>
              <dd className="text-content-light-secondary dark:text-content-dark-secondary">
                {action}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Button size="sm" variant="secondary" onClick={() => setContext({ kind: 'session' })}>
        Back to session
      </Button>
    </>
  );
}

function JointContext({ jointName }: { jointName: string }) {
  const clear = useSelection((s) => s.clear);
  const estimated = hasEstimatedTwist(jointName);

  return (
    <>
      <Section
        title="Joint"
        action={
          <Button size="sm" variant="ghost" onClick={clear}>
            Deselect
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-content-light-primary dark:text-content-dark-primary">
            {jointName}
          </span>
          {estimated && <Badge tone="warning">Twist estimated</Badge>}
        </div>
        <ReadOnlyRow label="Local rotation" value="read-only in this phase" />
      </Section>

      {estimated && (
        <Section title="Known limitation">
          <p
            className={cn(
              'rounded-lg bg-warning/10 px-2 py-2 text-[11px] leading-relaxed',
              'text-content-light-primary dark:text-content-dark-primary',
            )}
            data-testid="twist-caveat"
          >
            {TWIST_LIMITATION_NOTE}
          </p>
        </Section>
      )}
    </>
  );
}
