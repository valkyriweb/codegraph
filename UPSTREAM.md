# Upstream provenance

| | |
|---|---|
| Upstream | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) |
| License | MIT (see `LICENSE`) |
| Forked at | `572d22b` — `fix(installer): Codex TOML block finder…` (v1.5.0) |
| Fork branch | `lue/graph-accuracy-fixes` |
| Reason | Two resolution defects make `callers`/`impact` report confident false zeros on our codebases. Diagnosed during the CodeGraph adoption evaluation; see `my-pi:docs/codegraph-canary/findings.md`. |

## Why this fork exists

Upstream resolution runs three strategies in order — framework, import-based, then
**name matching as a fallback**. Name matching cannot cross a rename, so whenever the
identifier at a call site differs from the declaration's identifier the edge is lost and
the result is a confident zero rather than an error. Upstream is aware of the shape of
this problem (`src/resolution/import-resolver.ts:775`, issue #629) and has patched it
per-language/per-framework; the general case remained open.

Filed upstream as [#1482](https://github.com/colbymchenry/codegraph/issues/1482).

## Patch inventory

Keep this table current. Every entry must say what breaks upstream without it.

### 1. `.js` specifiers never resolve to `.ts` sources

- **Files**: `src/resolution/import-resolver.ts` (`TS_SOURCE_REWRITES`, `tsSourceCandidates`, applied in `resolveRelativeImport` + `resolveAliasedImport`)
- **Defect**: `EXTENSION_RESOLUTION` only ever *appends* a suffix, so `./x.js` is tried as
  `x.js.ts`, `x.js.tsx`, … then bare `x.js` — never `x.ts`. `"moduleResolution": "NodeNext"`
  *requires* the `.js` suffix, so on such a project **no relative import resolves at all**
  and every reference degrades to name matching.
- **Blast radius**: openclaw has 32,732 `.js`-suffixed relative imports and 0 extensionless.
  Its entire 1.26M-edge graph was built without import resolution.
- **Ordering**: rewrites are tried only *after* the literal path, so a real emitted `.js` on
  disk still wins and no already-resolving import changes target.

### 2. Calls through an alias binding stop one hop short

- **Files**: `src/resolution/alias-binding.ts` (new), wired in `src/resolution/index.ts`
  (`resolveOne` wraps `resolveOneStrategies`) and `src/resolution/import-resolver.ts`
  (`getFileExportIndex`)
- **Defect**: four distinct shapes, one symptom —
  - `export const alias = fn` — edge lands on the `constant`, not the function
  - `export { fn as alias }` — the exported name matches no declaration; resolution fails outright
  - `export const api = { run: fn }` — property holding a function reference
  - `const local = fn` — same-file alias
- **Fix**: extraction already stores the initializer in `Node.signature` (`"= fn"`), so the
  hop needs no re-parsing. Applied once in `resolveOne` because *any* strategy can produce
  an alias target. `calls` refs only — a `references` edge to the binding is correct as-is.
- **Ambiguity rule**: prefer a callable declared in the alias's own file; accept cross-file
  only when the name is unique project-wide. Ambiguous names produce no hop, never a guess —
  a wrong edge is worse than a missing one.

## Verification

- Upstream suite: **2,530 passed, 0 failed**, 175 skipped (`npx vitest run`).
  The skips are the `kernel-*-parity` files — we build TS only and run the wasm path, so the
  native kernel is absent. Both patches are in the TS resolution layer, which the kernel does
  not implement, but **the kernel path is unvalidated by this fork**.
- Pattern matrix: 8/8, up from 3/8. Fixtures cover both extensionless and `.js` specifiers,
  with and without a NodeNext `tsconfig.json`.
- Real-world: the `promptMigrationSkillSelectionValues` alias case in openclaw, whose two
  production call sites upstream omitted entirely.

## Build and run

The native kernel is **not** built. `cgdev` is the entry point.

```bash
npm ci && npm run build     # tsc only; skip build:kernel
./cgdev callers someSymbol  # pinned Node 24 + CODEGRAPH_KERNEL=0 + isolated HOME
```

`.dev-env` pins Node 24 because `src/bin/codegraph.ts:91-95` hard-exits on Node ≥ 25
(`engines: >=20 <25`) and this machine runs 26.x.

## Rebasing

Upstream moves fast and patches this area case-by-case, so expect conflicts in
`import-resolver.ts`. Re-run the pattern matrix after every rebase — the fixtures are the
contract, not the diff.

**Never run `npm uninstall @colbymchenry/codegraph` or `codegraph uninstall`**: the package's
`preuninstall` hook rewrites agent config files outside this directory.
