# tsx watch leaks a chokidar listener per watched file on every restart (macOS)

Minimal reproduction for tsx 4.23.15.

`node leak.cjs` generates 600 modules, runs `tsx watch` on them, edits one
module 150 times, and prints the watch parent's heap (after a full GC)
before and after. It exits 1 when the heap grew by more than 20 MB.

The [Actions](../../actions) workflow runs it on macOS and on Linux.

```sh
npm install
node leak.cjs
```

`FILES`, `RESTARTS` and `LIMIT_MB` override the defaults.
