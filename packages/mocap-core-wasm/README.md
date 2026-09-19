# @wms/mocap-core-wasm

Thin workspace wrapper around the `wasm-pack` output of `crates/mocap-core`.

```bash
pnpm build:wasm   # -> packages/mocap-core-wasm/pkg/
```

`pkg/` is generated and git-ignored. Consumers import the wrapper, never `pkg/` directly:

```ts
import init, { ping, OneEuroFilter } from '@wms/mocap-core-wasm';
await init();
```

Requires `wasm-pack` 0.13+, Rust stable 1.78+, and the `wasm32-unknown-unknown` target.
