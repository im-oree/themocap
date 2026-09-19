# Benchmark fixtures

The harness runs against fixed local clips so numbers are comparable across runs,
machines, and models. **Video files are git-ignored — do not commit them.**

## Required files

Place these in `tools/bench/public/fixtures/` (note: `public/`, so Vite serves them
same-origin):

| File               | Resolution | Purpose                       |
| ------------------ | ---------- | ----------------------------- |
| `walk-640x480.mp4` | 640×480    | Live-path presets             |
| `walk-1080p.mp4`   | 1920×1080  | Refine-path and depth presets |

## Requirements

- ~10 seconds.
- **Self-recorded or permissively licensed.** Record the source in this file when
  you add one. No scraped or unlicensed footage.
- A single person, fully in frame, with enough motion to exercise temporal
  smoothing: walking, a turn, and at least one fast limb movement.
- H.264 in MP4, constant frame rate (30 fps), so frame indexing is predictable.

Downscale the 1080p clip to produce the 640×480 one, so both show the _same_
motion and results are comparable across resolutions:

```bash
ffmpeg -i walk-1080p.mp4 -vf scale=640:480 -r 30 -c:v libx264 -crf 18 walk-640x480.mp4
```

## If the clips are missing

The harness falls back to a deterministic synthetic frame source (a moving figure
drawn to a canvas) so the UI is still exercisable. **Numbers from synthetic frames
must never be recorded in `docs/benchmarks.md`** — decode cost and image statistics
both differ from real video.

## Source attribution

| File         | Source | License |
| ------------ | ------ | ------- |
| _(none yet)_ |        |         |
