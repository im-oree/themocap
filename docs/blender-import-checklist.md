# Blender BVH import checklist

Acceptance criterion §17 requires that an exported BVH not merely round-trip inside
our own Rust test, but *import correctly into Blender*. Those are different claims:
the Rust test proves our writer and our reader agree, which a mutually-consistent
pair of bugs would also satisfy. Only a third-party importer settles it.

This checklist must be run by a human against a real Blender install. It cannot be
automated in this repo's CI — there is no Blender in the sandbox, and the failure
modes being hunted (rig visibly inside-out, limbs 100× too long, animation playing
at the wrong speed) are judged by eye.

## Environment

Record these when you run it, and paste the filled table into the results section.

| Field | Value |
| --- | --- |
| Blender version | _e.g. 4.2.1 LTS_ |
| OS | |
| App commit | `git rev-parse --short HEAD` |
| Export units | Centimeters (default) / Meters |
| Take used | |
| Date | |

## Producing the file

1. Record a take of at least 10 seconds with visible, unambiguous motion. Good
   content: start in a clean T-pose, hold 2 s, then raise **only the left arm**,
   then take two steps. Asymmetry matters — a symmetric pose will not reveal a
   left/right mirror bug, which is the single most likely axis defect.
2. Export BVH at the default settings (centimetres, 30 fps).
3. Note the reported frame count and duration from the app before leaving it.

## Import

In Blender: `File → Import → Motion Capture (.bvh)`. Leave all importer options at
their defaults — **do not** set "Rotation" or a scale correction to make it look
right. The whole point is that defaults work. If you need a correction to get a
sane result, that is a **failure**, and the correction you needed tells you which
axis convention is wrong upstream.

## Checks

Tick every box. A single unticked box fails the criterion.

### Structure

- [ ] Import completes with no error in the Blender console (`Window → Toggle
      System Console`).
- [ ] Exactly one armature object is created.
- [ ] The armature has **21 bones**.
- [ ] Bone names match ours exactly, `Hips` through `RightToeBase` — check
      `LeftShoulder`, `Spine1`, and `LeftToeBase` specifically, since those are the
      names most often renamed by exporters.
- [ ] The hierarchy is right: `Hips` is the only root; `Spine → Spine1 → Neck →
      Head`; both arms and both legs parented as documented in `decisions.md`.

### Orientation and scale

- [ ] The character stands **upright** (up the Blender `+Z` view axis — Blender is
      Z-up and its importer performs the Y-up conversion for us; if the rig lies on
      its back, our exporter is writing Z-up data it should not be).
- [ ] The character is roughly **1.7 m tall** in Blender's units, not 0.017 m and
      not 170 m. This is the check that catches a units mistake.
- [ ] The character faces the **`-Y`** direction in Blender (our `-Z` after the
      importer's axis conversion), i.e. away from the default front view.
- [ ] The **left arm** — the one that was raised in the recording — is the arm on
      screen-right when viewing from the front. Getting this backwards means `+X`
      is not the character's left somewhere in the chain.
- [ ] The feet are at or very near `Z = 0`, not sunk through the floor and not
      hovering. (A small offset is acceptable; foot locking is Document 3.)

### Animation

- [ ] Frame range in the timeline matches the recorded frame count.
- [ ] Scene fps set by the importer matches the export fps (30). If Blender reports
      a mismatch, our `Frame Time` line is wrong.
- [ ] Playback duration in seconds matches the recorded take length within ~0.1 s.
- [ ] Playback is **smooth** — no per-frame jitter, and critically no sudden 180°
      or 360° pops on any joint. Pops indicate a Euler-continuity problem in
      `quat_to_zxy_euler` that the round-trip test cannot see, because each frame is
      individually correct while the *sequence* is not.
- [ ] The motion is recognisably the motion that was performed.
- [ ] Elbows and knees bend in anatomically plausible directions — knees forward,
      elbows backward. A joint hinging the wrong way is a swing-axis sign error.

### Known-acceptable deviations

These are **not** failures at Document 2:

- Forearm and upper-arm *twist* (rotation about the bone's own axis) is estimated,
  not measured, and may look wrong during rotation-heavy motion. This is the
  documented twist caveat surfaced in the UI. Joints affected are listed in
  `TWIST_ESTIMATED_JOINTS`.
- Fingers, toes beyond `*ToeBase`, and facial motion are absent entirely — not in
  the 21-joint rig.
- Feet may slide along the ground. Foot locking is Document 3.
- Some high-frequency jitter is expected; the refine pipeline is Document 3.

## Results

> Fill in per run. Keep old runs — a regression is only visible against history.

### Run 1 — _not yet performed_

No run has been recorded. **This acceptance criterion is currently unmet** and must
be satisfied by a human with Blender before Document 2 can be called complete.

| Field | Value |
| --- | --- |
| Blender version | — |
| OS | — |
| App commit | — |
| Result | **Not run** |
| Notes | — |
