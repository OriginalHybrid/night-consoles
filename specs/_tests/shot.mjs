// Real-time headless screenshot via CDP.
// Chrome's --virtual-time-budget fast-forwards timers, so a live fetch is always
// still pending when the screenshot is taken. This drives Edge over CDP instead,
// waits for the page to settle, and captures at an exact viewport.
//
//   node shot.mjs <url> <out.png> [width] [height] [waitText] [timeoutMs]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [url, out, w = '1920', h = '1080', waitText = '', timeoutMs = '15000'] = process.argv.slice(2);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400 + Math.floor(Math.random() * 200);
const profile = `${process.env.TEMP}\\edge-cdp-${randomUUID().slice(0, 8)}`;

const child = spawn(EDGE, [
  '--headless=new', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${w},${h}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint(path) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' });
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
        const fns = this.events.get(m.method) || [];
        fns.forEach((f) => f(m.params));
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
      const f = (p) => { clearTimeout(t); this.events.set(method, (this.events.get(method) || []).filter((x) => x !== f)); resolve(p); };
      this.events.set(method, [...(this.events.get(method) || []), f]);
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
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    acceptLanguage: 'en-US,en;q=0.9'
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: +w, height: +h, deviceScaleFactor: 1, mobile: false
  });

  const loaded = cdp.once('Page.loadEventFired', +timeoutMs);
  await cdp.send('Page.navigate', { url });
  await loaded;

  // wait for an optional DOM marker, then a short settle window
  if (waitText) {
    const deadline = Date.now() + +timeoutMs;
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `document.body ? document.body.innerText.includes(${JSON.stringify(waitText)}) : false`,
        returnByValue: true
      });
      if (r.result && r.result.value === true) break;
      await sleep(250);
    }
  }
  await sleep(1200);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const state = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const b = document.getElementById('ins-badge'); return b ? b.textContent.trim() + ' | ' + (document.getElementById('ins-meta')||{}).textContent : 'n/a'; })()`,
    returnByValue: true
  });
  console.log('saved', out, '| badge:', state.result && state.result.value);
  if (errors.length) console.log('page errors:', JSON.stringify(errors.slice(0, 5)));

  const probe = process.argv[8];
  if (probe) {
    const p = await cdp.send('Runtime.evaluate', {
      expression: probe, returnByValue: true, awaitPromise: true
    });
    console.log('probe:', JSON.stringify(p.result && (p.result.value ?? p.result.description)));
  }
  ws.close();
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
