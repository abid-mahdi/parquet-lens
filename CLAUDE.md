# Parquet Lens

Browser-only viewer for Spark-written Parquet tables. See `~/CLAUDE.md` for global style rules.

**Live:** https://abid-mahdi.github.io/parquet-lens/ · **Repo:** https://github.com/abid-mahdi/parquet-lens

## What makes this different from other parquet viewers
Everything else treats a single `.parquet` file as the unit. Spark's unit is a **directory**. The whole
design follows from that: part files stitch into one logical table, and Hive `key=value` directories
become real columns even though those values appear nowhere inside the parquet data.

## Stack (deliberately small)
Five runtime deps: react, react-dom, @tanstack/react-virtual, hyparquet, hyparquet-compressors.
Vite + TS strict. Plain CSS with custom properties, no Tailwind. No Arrow, no DuckDB, no Comlink.

## Layout
- `src/core/` pure TS, zero browser deps, so it tests headless in Node
- `src/worker/` decode off the main thread, typed RPC with cancellation
- `src/hooks/useRowWindow.ts` the windowed row store, the perf heart
- `src/ui/` grid, legend, inspectors

## Performance traps already hit (do not regress these)
- **Spark writes ONE row group per part.** `alignToRowGroups` must stay capped (`maxRows`, default
  4096). Uncapped, a 256-row request widened to 312,501 rows: 6x slower open, 13x slower seek.
- `useOffsetIndex: true` on every read. It is what lets hyparquet skip to the right pages.
- Rendering must never await a decode. Cache or skeleton, always.
- The row-number gutter is pinned via a CSS variable set in the scroll handler, deliberately keeping
  horizontal scroll off the React render path.

Budgets are enforced in `tests/e2e/performance.spec.ts` and fail the build. Current numbers on the
469 MB fixture: 236 ms open, 18.2 ms p95 frame, 160 ms mid-table seek, 125 MB heap.

## Fixtures
Authored by **real Spark 3.3.2** via `tools/fixture-gen/run.sh`, not hand-rolled. Small ones are
committed so tests and CI need no JVM. `--big` builds the gitignored 469 MB perf fixture.

**sbt ignores the system JDK.** Homebrew sbt launched under Java 19, which Spark 3.3 does not support.
`run.sh` pins `JAVA_HOME` to Java 11 via `/usr/libexec/java_home -v 11`. Do not remove that.

## Verification rules
- `tsc` passing proves nothing until you have seen it fail. rtk compresses `--listFiles`, so confirm
  coverage by injecting a deliberate type error and watching exit code 2.
- A green e2e test that only asserts "element visible" can hide a table rendering skeletons forever.
  The schema-mismatch test asserts actual cell text and a nonzero cache, because the weak version passed
  while the grid was completely broken.

## Query builder
Clicks accumulate into a Query (`src/core/query.ts`, pure and fully tested) which is both rendered as
Scala and executed (`src/core/execute.ts`). Execution returns physical row indices; the grid addresses
rows through that view.

- **The row cache key must advance on every applied query**, not on row count. A sort changes order but
  not count, and keying on count left the grid showing stale unsorted rows while the header and the
  generated code both claimed it was sorted. Screenshots caught it; the test had passed by coincidence
  because the first unsorted value happened to equal the first sorted one.
- Partition filters prune whole parts without reading. Data filters skip row groups via min/max
  statistics. Both counts are surfaced in the panel, which is the main teaching payload.

## Not built yet
Multi-column sort, OR across filters, aggregation (wants DuckDB-WASM, ~40 MB, deliberately deferred),
remote files over HTTP range requests.
