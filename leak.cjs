// Minimal reproduction: `tsx watch` keeps one more chokidar listener per
// watched file on every restart.
//
// Generates FILES modules, runs `tsx watch` on them with --expose-gc on the
// watch PARENT only (the child never gets the flag), edits one module
// RESTARTS times, and compares the parent's heap after a full GC.
// Exits 1 when the heap grew by more than LIMIT_MB.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILES = Number(process.env.FILES || 600);
const RESTARTS = Number(process.env.RESTARTS || 150);
const LIMIT_MB = Number(process.env.LIMIT_MB || 20);

const cli = require.resolve('tsx/cli');
const tsxVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(cli), '..', 'package.json'), 'utf8')).version;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsx-leak-'));
for (let i = 1; i < FILES; i++) fs.writeFileSync(path.join(dir, `m${i}.ts`), `export const v${i} = ${i};\n`);
fs.writeFileSync(path.join(dir, 'm0.ts'), 'export const V = 0;\n');
fs.writeFileSync(path.join(dir, 'index.ts'),
  "import { V } from './m0';\n" +
  Array.from({ length: FILES - 1 }, (_, k) => `import './m${k + 1}';`).join('\n') +
  "\nconsole.log('BOOT', V);\nsetInterval(() => {}, 1e6);\n");

const probe = path.join(dir, 'probe.cjs');
fs.writeFileSync(probe,
  "process.on('SIGUSR2', () => { global.gc(); global.gc(); " +
  "require('fs').writeFileSync(process.env.HEAP_OUT, String(process.memoryUsage().heapUsed)); });\n");
const heapOut = path.join(dir, 'heap');

const watch = spawn(process.execPath, ['--expose-gc', '--require', probe, cli, 'watch', '--clear-screen=false', 'index.ts'],
  { cwd: dir, env: { ...process.env, HEAP_OUT: heapOut }, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
watch.stdout.on('data', (d) => { out += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(message) {
  console.error(`FAILED: ${message}\n--- last output ---\n${out.slice(-1500)}`);
  watch.kill('SIGKILL');
  process.exit(2);
}
async function waitBoot(n) {
  const deadline = Date.now() + 30000;
  while (!out.includes(`BOOT ${n}\n`)) {
    if (Date.now() > deadline) fail(`no restart for edit ${n} within 30 s`);
    await sleep(20);
  }
}
async function heapMB() {
  try { fs.unlinkSync(heapOut); } catch {}
  watch.kill('SIGUSR2');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(heapOut)) {
    if (Date.now() > deadline) fail('watch parent did not report its heap');
    await sleep(20);
  }
  await sleep(50);
  return Number(fs.readFileSync(heapOut, 'utf8')) / 1048576;
}

(async () => {
  console.log(`tsx ${tsxVersion}, node ${process.version}, ${process.platform}/${process.arch}; ${FILES} files, ${RESTARTS} restarts`);
  await waitBoot(0);
  await sleep(500);
  const before = await heapMB();
  for (let i = 1; i <= RESTARTS; i++) {
    fs.writeFileSync(path.join(dir, 'm0.ts'), `export const V = ${i};\n`);
    await waitBoot(i);
  }
  const after = await heapMB();
  const grew = after - before;
  console.log(`tsx watch parent heapUsed: ${before.toFixed(1)} MB -> ${after.toFixed(1)} MB ` +
    `(+${grew.toFixed(1)} MB, ${(grew * 1024 / RESTARTS).toFixed(0)} KB per restart)`);
  watch.kill('SIGTERM');
  if (grew > LIMIT_MB) {
    console.error(`LEAK: the watch parent kept ${grew.toFixed(1)} MB over ${RESTARTS} restarts (limit ${LIMIT_MB} MB)`);
    process.exitCode = 1;
  } else {
    console.log('OK: the watch parent stayed flat');
  }
})();
