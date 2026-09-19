import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Panel,
  PerfHUD,
  ThemeToggle,
  Toaster,
  Toolbar,
  toast,
  useThemeStore,
} from '@wms/ui';
import { detectCapabilities } from '@wms/inference/capabilities';
import type { BackendId, Capabilities } from '@wms/inference/types';
import { manifest } from '@wms/models';
import { ResultsChart } from './components/ResultsChart';
import { FIXTURES, PRESETS, benchCandidates, resolveModels } from './lib/presets';
import { runAgreementCheck, runBenchmark, type RunResult } from './lib/runner';
import { agreementToMarkdown, environmentBlock, resultToMarkdown } from './lib/markdown';

const BACKENDS: { id: BackendId; label: string }[] = [
  { id: 'ort-web-wasm', label: 'ORT Web — WASM' },
  { id: 'ort-web-webgpu', label: 'ORT Web — WebGPU' },
];

const selectClass =
  'h-11 w-full rounded-xl border border-hairline-light bg-white/80 px-3 text-sm ' +
  'dark:border-hairline-dark dark:bg-white/[0.06] dark:text-content-dark-primary';

type Mode = 'preset' | 'single';

export function App() {
  const initTheme = useThemeStore((s) => s.init);
  useEffect(() => initTheme(), [initTheme]);

  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    void detectCapabilities().then(setCaps);
  }, []);

  const candidates = useMemo(() => benchCandidates(), []);
  const [mode, setMode] = useState<Mode>('preset');
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [modelId, setModelId] = useState(candidates[0]?.id ?? '');
  const [backend, setBackend] = useState<BackendId>('ort-web-wasm');

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ message: string; fraction: number } | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [markdown, setMarkdown] = useState('');

  const preset = PRESETS.find((p) => p.id === presetId)!;
  const missing = useMemo(() => manifest.models.filter((m) => !m.acquired).length, []);

  const buildConfig = () => {
    const models = mode === 'preset' ? resolveModels(preset.modelIds) : resolveModels([modelId]);
    const fixture = FIXTURES[mode === 'preset' ? preset.clip : 'live-640x480'];
    return {
      models,
      clipUrl: fixture.url,
      clipLabel: fixture.label,
      repeats: 3,
      maxFrames: 60,
      onProgress: (message: string, fraction: number) => setProgress({ message, fraction }),
    };
  };

  const heading = () =>
    mode === 'preset'
      ? `${preset.name} — ${FIXTURES[preset.clip].label}`
      : `${candidates.find((c) => c.id === modelId)?.displayName ?? modelId} — 640x480`;

  async function handleRun() {
    setRunning(true);
    setProgress({ message: 'Starting…', fraction: 0 });
    try {
      const result = await runBenchmark({ ...buildConfig(), backend });
      setResults((prev) => [result, ...prev]);
      setMarkdown(environmentBlock() + resultToMarkdown(result, heading()));
      toast({ title: 'Run complete', tone: 'success', description: heading() });
    } catch (error) {
      toast({
        title: 'Run failed',
        tone: 'danger',
        description: error instanceof Error ? error.message : String(error),
        duration: 8000,
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function handleAgreement() {
    setRunning(true);
    setProgress({ message: 'Running WASM pass…', fraction: 0 });
    try {
      const { wasm, webgpu, agreement } = await runAgreementCheck(buildConfig());
      setResults((prev) => [webgpu, wasm, ...prev]);
      setMarkdown(
        environmentBlock() +
          resultToMarkdown(wasm, heading()) +
          '\n' +
          resultToMarkdown(webgpu, `${heading()} (WebGPU)`) +
          '\n' +
          agreementToMarkdown(agreement),
      );
      toast({ title: 'A/B complete', tone: 'success', description: 'WASM vs WebGPU compared' });
    } catch (error) {
      toast({
        title: 'A/B failed',
        tone: 'danger',
        description: error instanceof Error ? error.message : String(error),
        duration: 8000,
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    toast({
      title: 'Copied',
      description: 'Paste straight into docs/benchmarks.md',
      tone: 'accent',
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-light dark:bg-surface-dark">
      <Toolbar
        leading={
          <span className="text-[15px] font-semibold tracking-tight">Benchmark Harness</span>
        }
        trailing={<ThemeToggle />}
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        {missing > 0 && (
          <Panel className="border-warning/40">
            <h2 className="text-sm font-semibold">
              {missing} model file{missing === 1 ? '' : 's'} not yet acquired
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-content-light-secondary dark:text-content-dark-secondary">
              The manifest lists candidates but the ONNX files are not in{' '}
              <code className="font-mono text-xs">tools/bench/public/models/</code>. Follow{' '}
              <em>Model acquisition</em> in{' '}
              <code className="font-mono text-xs">docs/decisions.md</code> to fetch and checksum
              them, then set <code className="font-mono text-xs">acquired: true</code>. Runs against
              missing files fail loudly rather than reporting fake numbers.
            </p>
          </Panel>
        )}

        <Panel title="Configuration">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mode" className="mb-1.5 block text-[13px] font-medium">
                What to run
              </label>
              <select
                id="mode"
                className={selectClass}
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="preset">Pipeline preset</option>
                <option value="single">Single model</option>
              </select>
            </div>

            {mode === 'preset' ? (
              <div>
                <label htmlFor="preset" className="mb-1.5 block text-[13px] font-medium">
                  Preset
                </label>
                <select
                  id="preset"
                  className={selectClass}
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.description}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="model" className="mb-1.5 block text-[13px] font-medium">
                  Candidate model
                </label>
                <select
                  id="model"
                  className={selectClass}
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} · {c.task}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="backend" className="mb-1.5 block text-[13px] font-medium">
                Backend
              </label>
              <select
                id="backend"
                className={selectClass}
                value={backend}
                onChange={(e) => setBackend(e.target.value as BackendId)}
              >
                {BACKENDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <Button variant="primary" onClick={handleRun} disabled={running}>
                {running ? 'Running…' : 'Run benchmark'}
              </Button>
              <Button onClick={handleAgreement} disabled={running}>
                WASM vs WebGPU
              </Button>
            </div>
          </div>

          {caps && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={caps.simd ? 'success' : 'warning'}>
                SIMD {caps.simd ? 'on' : 'off'}
              </Badge>
              <Badge tone={caps.threads ? 'success' : 'warning'}>
                threads {caps.threads ? `${caps.hardwareConcurrency} cores` : 'off'}
              </Badge>
              <Badge tone={caps.webgpu ? 'success' : 'neutral'}>
                WebGPU {caps.webgpu ? 'available' : 'unavailable'}
              </Badge>
              <Badge tone={caps.crossOriginIsolated ? 'success' : 'danger'}>
                {caps.crossOriginIsolated ? 'cross-origin isolated' : 'NOT isolated'}
              </Badge>
            </div>
          )}

          {progress && (
            <div className="mt-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-180 ease-apple-out"
                  style={{ width: `${Math.min(100, progress.fraction * 100).toFixed(1)}%` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-xs text-content-light-secondary dark:text-content-dark-secondary">
                {progress.message}
              </p>
            </div>
          )}
        </Panel>

        {results.length > 0 && (
          <Panel
            title="Results"
            actions={
              <Button size="sm" onClick={copyMarkdown}>
                Copy Markdown
              </Button>
            }
          >
            <ResultsChart result={results[0]!} />
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-content-light-secondary dark:text-content-dark-secondary">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Model</th>
                    <th className="py-2 pr-4 font-medium">Backend</th>
                    <th className="py-2 pr-4 font-medium">Prec.</th>
                    <th className="py-2 pr-4 font-medium">FPS</th>
                    <th className="py-2 pr-4 font-medium">p90 ms</th>
                    <th className="py-2 pr-4 font-medium">Load</th>
                    <th className="py-2 font-medium">Peak heap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline-light dark:divide-hairline-dark">
                  {results[0]!.perModel.map((m) => (
                    <tr key={m.modelId}>
                      <td className="py-2 pr-4">{m.displayName}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{m.backend}</td>
                      <td className="py-2 pr-4">{m.precision}</td>
                      <td className="py-2 pr-4">
                        {m.error ? <Badge tone="danger">failed</Badge> : m.stats.avgFps.toFixed(1)}
                      </td>
                      <td className="py-2 pr-4">{m.error ? '—' : m.stats.p90FrameMs.toFixed(1)}</td>
                      <td className="py-2 pr-4">
                        {m.error ? '—' : `${m.loadTimeMs.toFixed(0)} ms`}
                      </td>
                      <td className="py-2">
                        {m.peakHeapBytes === null
                          ? 'n/a'
                          : `${(m.peakHeapBytes / 1048576).toFixed(0)} MB`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <textarea
              readOnly
              value={markdown}
              aria-label="Results as Markdown"
              className="mt-5 h-56 w-full rounded-xl border border-hairline-light bg-black/[0.03] p-3 font-mono text-xs dark:border-hairline-dark dark:bg-white/[0.04]"
            />
          </Panel>
        )}
      </main>

      <PerfHUD defaultVisible />
      <Toaster />
    </div>
  );
}
