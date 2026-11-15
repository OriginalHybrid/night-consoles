import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const [url, outDir, waitText = '', durationMs = '2500', fps = '8', w = '1600', h = '900', format = 'png'] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: node capture-preview-loop.mjs <url> <outDir> [waitText] [durationMs] [fps] [width] [height]');
  process.exit(1);
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9600 + Math.floor(Math.random() * 200);
const profile = `${process.env.TEMP}\\edge-cdp-${randomUUID().slice(0, 8)}`;
const child = spawn(EDGE, [
  '--headless=new', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function endpoint(p) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: p.startsWith('/json/new') ? 'PUT' : 'GET' });
      if (r.ok) return await r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('devtools endpoint never came up');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) {
        (this.events.get(m.method) || []).forEach((fn) => fn(m.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, ms = 8000) {
    return new Promise((resolve) => {
      const fn = (p) => { clearTimeout(t); this.events.set(method, (this.events.get(method) || []).filter((x) => x !== fn)); resolve(p); };
      this.events.set(method, [...(this.events.get(method) || []), fn]);
      const t = setTimeout(() => resolve(null), ms);
    });
  }
}

try {
  const target = await endpoint(`/json/new?${encodeURIComponent('about:blank')}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  const errors = [];
  cdp.events.set('Runtime.exceptionThrown', [(p) => errors.push((p.exceptionDetails && p.exceptionDetails.text) || 'exception')]);
  cdp.events.set('Runtime.consoleAPICalled', [(p) => { if (p.type === 'error') errors.push((p.args || []).map((a) => a.value || a.description).join(' ')); }]);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  const loaded = cdp.once('Page.loadEventFired', 25000);
  await cdp.send('Page.navigate', { url });
  await loaded; console.log('loaded');

  if (waitText) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `document.body ? document.body.innerText.includes(${JSON.stringify(waitText)}) : false`,
        returnByValue: true
      });
      if (r.result && r.result.value === true) break;
      await sleep(250);
    }
  }
  console.log('waiting settle'); await sleep(1800); console.log('capturing');

  mkdirSync(outDir, { recursive: true });
  const interval = 1000 / Math.max(1, +fps);
  const count = Math.max(1, Math.round(+durationMs / interval));
  for (let i = 0; i < count; i++) {
    const shot = await cdp.send('Page.captureScreenshot', format === 'jpeg' ? { format: 'jpeg', quality: 82, captureBeyondViewport: false } : { format: 'png', captureBeyondViewport: false });
    const ext = format === 'jpeg' ? '.jpg' : '.png';
    writeFileSync(path.join(outDir, String(i).padStart(3, '0') + ext), Buffer.from(shot.data, 'base64'));
    console.log('frame', i); await sleep(interval);
  }
  console.log(`captured ${count} frames -> ${outDir}`);
  if (errors.length) console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
  ws.close();
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
