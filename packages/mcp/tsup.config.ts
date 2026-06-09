import { defineConfig } from 'tsup'

// Bundle the MCP server into a single dist/server.mjs that runs with `node`
// alone. Workspace and third-party deps are inlined; only Node built-ins and the
// embedding runtime stay external.
export default defineConfig({
  entry: { server: 'src/server.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  // Inline everything EXCEPT the embedding runtime. The negative lookahead is
  // required: a bare `noExternal: [/.*/]` would force-bundle them back in even
  // when listed in `external` (noExternal wins in tsup).
  noExternal: [/^(?!@huggingface\/transformers|onnxruntime-node|sharp)/],
  // The embedding runtime can't be inlined: bundling onnxruntime-node breaks its
  // native backend registration (`listSupportedBackends is not a function`), and
  // sharp ships platform binaries. `core` loads `@huggingface/transformers` via a
  // dynamic import at runtime, resolved from node_modules (it's a direct dep of
  // this package, so it's reachable from dist/), only when embeddings are enabled.
  external: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
  outExtension: () => ({ js: '.mjs' }),
  clean: true,
  shims: true
})
