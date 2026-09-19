import { useEffect, useState } from 'react';
// Subpath import: the barrel pulls in onnxruntime-web (28 MB of wasm), which the
// shell does not need. Inference lands in Document 2.
import { detectCapabilities } from '@wms/inference/capabilities';
import type { Capabilities } from '@wms/inference/types';
import { Badge, type StatusTone } from '@wms/ui';
import { probeMocapCore, type WasmProbeResult } from '../lib/wasmBridge';

interface Row {
  label: string;
  value: string;
  tone: StatusTone;
  hint?: string;
}

function yesNo(ok: boolean, yes = 'Yes', no = 'No'): { value: string; tone: StatusTone } {
  return { value: ok ? yes : no, tone: ok ? 'success' : 'warning' };
}

/**
 * Dev-only live smoke test: capability detection + the WASM round trip, visible
 * every time someone opens the app.
 */
export function Diagnostics() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [probe, setProbe] = useState<WasmProbeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectCapabilities().then((c) => !cancelled && setCaps(c));
    void probeMocapCore().then((p) => !cancelled && setProbe(p));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Row[] = [];

  if (caps) {
    const coi = yesNo(caps.crossOriginIsolated);
    rows.push({
      label: 'crossOriginIsolated',
      ...coi,
      hint: caps.crossOriginIsolated ? undefined : 'COOP/COEP headers missing — threads disabled',
    });
    rows.push({ label: 'WASM SIMD', ...yesNo(caps.simd) });
    rows.push({
      label: 'WASM threads',
      ...yesNo(caps.threads),
      hint: `${caps.hardwareConcurrency} logical cores`,
    });
    rows.push({
      label: 'WebGPU',
      ...yesNo(caps.webgpu, 'Available', 'Unavailable'),
    });
  }

  if (probe) {
    rows.push({
      label: 'mocap-core ping(21)',
      value: probe.error ? 'failed' : String(probe.pingResult),
      tone: probe.ok ? 'success' : 'danger',
      hint: probe.error ?? `core v${probe.coreVersion} · ${probe.elapsedMs.toFixed(1)} ms`,
    });
    if (probe.filterVariance !== null) {
      rows.push({
        label: 'OneEuroFilter variance',
        value: probe.filterVariance.toExponential(2),
        tone: probe.filterVariance < 0.01 ? 'success' : 'danger',
        hint: 'noisy constant, last 10 samples',
      });
    }
  }

  const loading = !caps || !probe;

  return (
    <div data-testid="diagnostics" className="w-full">
      <dl className="divide-y divide-hairline-light dark:divide-hairline-dark">
        {loading && (
          <p className="py-3 text-sm text-content-light-secondary dark:text-content-dark-secondary">
            Running startup checks…
          </p>
        )}
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <dt className="font-mono text-[13px]">{row.label}</dt>
              {row.hint && (
                <dd className="truncate text-xs text-content-light-secondary dark:text-content-dark-secondary">
                  {row.hint}
                </dd>
              )}
            </div>
            <Badge tone={row.tone} data-testid={`diag-${row.label}`}>
              {row.value}
            </Badge>
          </div>
        ))}
      </dl>
    </div>
  );
}
