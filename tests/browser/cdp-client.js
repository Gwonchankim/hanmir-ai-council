'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT = 10_000;

function browserCandidates() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  return [
    process.env.AI_COUNCIL_BROWSER,
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localAppData && path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
}

function findBrowserExecutable() {
  const executable = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    const error = new Error(
      'Chromium browser not found. Set AI_COUNCIL_BROWSER to msedge.exe or chrome.exe.',
    );
    error.code = 'BROWSER_NOT_FOUND';
    throw error;
  }
  return executable;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function poll(fn, {
  timeout = DEFAULT_TIMEOUT,
  interval = 50,
  message = 'Condition did not become true',
} = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const error = new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
  error.cause = lastError;
  throw error;
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = null;
  }

  async connect() {
    const socket = new WebSocket(this.webSocketUrl);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to browser CDP')), DEFAULT_TIMEOUT);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(event.error || new Error('Browser CDP WebSocket failed'));
      }, { once: true });
    });
    socket.addEventListener('message', (event) => this._onMessage(event));
    socket.addEventListener('close', () => this._rejectPending(new Error('Browser CDP closed')));
    return this;
  }

  async _onMessage(event) {
    let raw = event.data;
    if (typeof raw !== 'string') {
      if (raw && typeof raw.text === 'function') raw = await raw.text();
      else raw = Buffer.from(raw).toString('utf8');
    }
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (!message.method) return;
    for (const listener of [...(this.listeners.get(message.method) || [])]) {
      listener(message.params || {});
    }
  }

  _rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, { timeout = DEFAULT_TIMEOUT } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Browser CDP is not connected'));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, { timeout = DEFAULT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      const listeners = this.listeners.get(method) || new Set();
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`${method} event timed out after ${timeout}ms`));
      }, timeout);
      const listener = (params) => {
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(params);
      };
      listeners.add(listener);
      this.listeners.set(method, listeners);
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description
        || response.exceptionDetails.text
        || 'Browser evaluation failed';
      throw new Error(detail);
    }
    return response.result?.value;
  }

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

async function launchBrowser() {
  const executable = findBrowserExecutable();
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-browser-'));
  const child = spawn(executable, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--disable-gpu',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-service-autorun',
    '--password-store=basic',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });

  let client;
  try {
    const target = await poll(async () => {
      if (child.exitCode !== null) throw new Error(`Browser exited with code ${child.exitCode}`);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const targets = await response.json();
      return targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    }, { timeout: 15_000, message: 'Browser debugging endpoint did not become ready' });
    client = await new CdpClient(target.webSocketDebuggerUrl).connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch (error) {
    child.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  return {
    client,
    executable,
    async close() {
      try { await client.send('Browser.close', {}, { timeout: 1_500 }); } catch (_) { /* browser may exit first */ }
      client.close();
      if (child.exitCode === null) child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

async function setViewportAndNavigate(client, url, { width, height }) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = client.waitForEvent('Page.loadEventFired', { timeout: 15_000 });
  await client.send('Page.navigate', { url });
  await loaded;
  await poll(
    () => client.evaluate(`(() => {
      const count = Number(document.querySelector('#sessionCount')?.textContent || 0);
      const harness = document.querySelector('#orchestratorHarness');
      return document.readyState === 'complete' && count >= 2
        && harness && harness.dataset.savedContent !== undefined;
    })()`),
    { timeout: 15_000, message: `AI Council UI did not initialize at ${width}px` },
  );
}

module.exports = {
  CdpClient,
  browserCandidates,
  findBrowserExecutable,
  launchBrowser,
  poll,
  setViewportAndNavigate,
};
