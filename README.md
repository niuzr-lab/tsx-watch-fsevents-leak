# tsx watch leaks a chokidar listener per watched file on every restart (macOS)

Minimal reproduction for tsx 4.23.15, reported in
https://github.com/privatenumber/tsx/issues/855.

`node leak.cjs` generates 600 modules, runs `tsx watch` on them, edits one
module 150 times, and prints the watch parent's heap (after a full GC)
before and after. It exits 1 when the heap grew by more than 20 MB.

The [Actions](../../actions) workflow runs it on macOS and on Linux.

The leak needs `fsevents`, which tsx lists as an optionalDependency: tsx's
bundled chokidar v3 uses its FSEvents handler only when `fsevents` resolves,
and that handler is the one that never dedupes a repeated `add()`. Without
`fsevents`, chokidar falls back to `fs.watch`, which skips already-watched
files, and nothing leaks. `leak.cjs` prints which handler is in use.

CI installs with pnpm. On the macOS runner, npm 11.19 did not install
`fsevents` at all (`npm ls fsevents` was empty, even after
`npm install fsevents@2.3.3`), so an npm-based run there never reaches
the FSEvents handler.

```sh
pnpm install
node leak.cjs
```

`FILES`, `RESTARTS` and `LIMIT_MB` override the defaults.
