import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("cache/tencent-browser");
const port = 19247;
const base = "http://127.0.0.1:18880";
const waline = "http://127.0.0.1:18360";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
await mkdir(root, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--disable-background-networking",
  `--user-data-dir=${path.join(root, "chrome-profile")}`,
  `--remote-debugging-port=${port}`, "about:blank",
], { stdio: "ignore" });

let socket;
let nextId = 0;
const pending = new Map();
const api = [];
let failures = [];
const browserErrors = [];

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const target = targets.find((item) => item.type === "page");
      if (target) {
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        });
        socket.addEventListener("message", async (event) => {
          const message = JSON.parse(event.data);
          if (message.id) {
            const task = pending.get(message.id);
            if (!task) return;
            pending.delete(message.id);
            message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
          } else if (message.method === "Fetch.requestPaused") {
            await forward(message.params).catch(async (error) => {
              failures.push(`route: ${error.message}`);
              await send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "Failed" }).catch(() => {});
            });
          } else if (message.method === "Network.loadingFailed") {
            browserErrors.push({ requestId: message.params.requestId, errorText: message.params.errorText });
          } else if (message.method === "Runtime.exceptionThrown") {
            browserErrors.push({ exception: message.params.exceptionDetails?.text });
          }
        });
        return;
      }
    } catch {}
    await sleep(100);
  }
  throw new Error("Chrome DevTools endpoint unavailable");
}

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function forward({ requestId, request }) {
  const source = new URL(request.url);
  if (source.origin !== base && source.origin !== waline && source.hostname !== "comments.dcelysion.cn") {
    await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    return;
  }
  if (source.origin !== waline && source.hostname !== "comments.dcelysion.cn") {
    await send("Fetch.continueRequest", { requestId });
    return;
  }
  const target = new URL(source.pathname + source.search, waline);
  // Preview navigation must not increment the real visit counters.
  if (source.pathname === "/api/article" && request.method === "POST") {
    await send("Fetch.fulfillRequest", {
      requestId, responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: base }, { name: "access-control-allow-credentials", value: "true" }],
      body: Buffer.from(JSON.stringify({ errno: 0, data: [] })).toString("base64"),
    });
    return;
  }
  const headers = new Headers(request.headers);
  headers.set("origin", "https://blog.dcelysion.cn");
  headers.set("referer", "https://blog.dcelysion.cn/guestbook/");
  headers.delete("host");
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.postData,
    redirect: "manual",
  });
  const responseHeaders = [...response.headers].filter(([key]) => !["content-encoding", "content-length", "access-control-allow-origin", "access-control-allow-credentials"].includes(key));
  responseHeaders.push(["access-control-allow-origin", base]);
  responseHeaders.push(["access-control-allow-credentials", "true"]);
  const body = Buffer.from(await response.arrayBuffer()).toString("base64");
  api.push({ method: request.method, endpoint: source.pathname, status: response.status, path: source.searchParams.get("path") });
  await send("Fetch.fulfillRequest", {
    requestId,
    responseCode: response.status,
    responseHeaders: responseHeaders.map(([name, value]) => ({ name, value })),
    body,
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evaluate(expression).catch(() => null);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function navigate(url) {
  await send("Page.navigate", { url: base + url });
  await waitFor(`location.pathname === ${JSON.stringify(new URL(url, base).pathname)} && document.readyState !== 'loading'`, 30000);
}

async function snapshot(label) {
  await waitFor("!!document.querySelector('#waline .wl-panel')");
  await sleep(500);
  const state = await evaluate(`JSON.stringify({
    path: location.pathname,
    panels: document.querySelectorAll('#waline .wl-panel').length,
    editors: document.querySelectorAll('#waline .wl-editor').length,
    textareas: document.querySelectorAll('#waline textarea').length,
    logins: document.querySelectorAll('#waline .wl-login-btn, #waline .wl-login, #waline [class*=login]').length,
    editorText: document.querySelector('#waline .wl-editor')?.innerText.slice(0, 100),
    textareaPlaceholder: document.querySelector('#waline textarea')?.getAttribute('placeholder'),
    textareaDisabled: document.querySelector('#waline textarea')?.disabled,
    anonymousInputs: document.querySelectorAll('#waline .wl-header input').length,
    submitPresent: !!document.querySelector('#waline .wl-btn.primary'),
    buttons: [...document.querySelectorAll('#waline .wl-editor button')].map(b => ({text: b.innerText.slice(0, 30), disabled: b.disabled})),
    loginWordsVisible: (document.querySelector('#waline')?.innerText || '').includes('登录'),
    formClasses: [...document.querySelectorAll('#waline [class]')].map(e => e.className).filter(c => typeof c === 'string' && /wl-(?:btn|login|submit|panel|header|input|editor)/.test(c)).slice(0, 24),
    cta: [...document.querySelectorAll('#waline .wl-btn')].map(e => ({tag: e.tagName, text: e.innerText.slice(0, 24)})),
    swup: !!window.swup,
    configuredPath: JSON.parse(document.querySelector('#waline').dataset.walineConfig).path,
    loginMode: JSON.parse(document.querySelector('#waline').dataset.walineConfig).login,
    anonymousLabel: JSON.parse(document.querySelector('#waline').dataset.walineConfig).locale?.anonymous
  })`);
  console.log(label, state);
  const actual = JSON.parse(state);
  if (actual.loginMode !== "enable" || actual.anonymousLabel !== "匿名用户" || actual.panels !== 1 || actual.editors !== 1 || actual.textareas !== 1 || actual.textareaDisabled !== false || actual.anonymousInputs < 2 || !actual.submitPresent || !actual.loginWordsVisible) {
    throw new Error("Anonymous editor and optional login must both be available exactly once");
  }
}

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await navigate("/");
  await waitFor("!!window.swup");
  await evaluate("document.querySelector('a[href=\"/guestbook/\"]')?.click()");
  await waitFor("location.pathname === '/guestbook/'");
  await snapshot("guestbook-first");
  if (!process.argv.includes("--auth-only")) {
  await evaluate("document.querySelector('a[href=\"/\"]')?.click()");
  await waitFor("location.pathname === '/'");
  await evaluate("document.querySelector('a[href=\"/guestbook/\"]')?.click()");
  await waitFor("location.pathname === '/guestbook/'");
  await snapshot("guestbook-second");
  await navigate("/dynamic/");
  const dynamicSrc = await waitFor("document.querySelector('dynamic-inline-comments[data-src]')?.dataset.src");
  console.log("dynamic-src-shape", /^\/dynamic\/comments\/\?path=%2Fdynamic%2F[^/]+%2F$/.test(dynamicSrc));
  await navigate(dynamicSrc);
  await snapshot("dynamic-override");
  }
  console.log("api", JSON.stringify(api));
  console.log("routeFailures", failures.length);
  if (failures.length) throw new Error("Comment API forwarding failed");
} catch (error) {
  console.error("SMOKE FAILED", error.message);
  console.error("browserState", await evaluate("JSON.stringify({url: location.href, ready: document.readyState, title: document.title})").catch(() => "unavailable"));
  console.error("scripts", await evaluate("JSON.stringify([...document.scripts].filter(s => s.type === 'module').slice(0, 8).map(s => s.src || 'inline'))").catch(() => "unavailable"));
  console.error("resources", await evaluate("JSON.stringify(performance.getEntriesByType('resource').filter(r => r.name.includes('/_astro/')).slice(0, 12).map(r => ({name: new URL(r.name).pathname, status: r.responseStatus, duration: Math.round(r.duration)})))").catch(() => "unavailable"));
  console.error("api", JSON.stringify(api));
  console.error("routeFailures", failures.slice(0, 3));
  console.error("browserErrors", browserErrors.slice(0, 10));
  process.exitCode = 1;
} finally {
  socket?.close();
  chrome.kill();
}
