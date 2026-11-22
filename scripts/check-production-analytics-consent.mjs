#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const siteUrl = process.argv[2]
const chromeBin = process.env.CHROME_BIN

if (!siteUrl || !/^https:\/\//.test(siteUrl)) {
  throw new Error('Usage: node check-production-analytics-consent.mjs https://example.com')
}
if (!chromeBin) {
  throw new Error('CHROME_BIN is required.')
}

const profile = await mkdtemp(join(tmpdir(), 'bookblog-consent-smoke-'))
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let socket
const pending = new Map()
let nextCommandId = 0

async function waitFor(readValue, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chromium exited early while waiting for ${description}.`)
    }
    try {
      const value = await readValue()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(300)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ''}`)
}

async function command(method, params = {}) {
  const id = ++nextCommandId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Chrome DevTools command timed out: ${method}`))
    }, 12000)
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value) },
      reject(error) { clearTimeout(timer); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.')
  }
  return result.result?.value
}

try {
  const portFile = join(profile, 'DevToolsActivePort')
  const portInfo = await waitFor(async () => {
    try {
      const lines = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/)
      return lines[0] ? { port: lines[0] } : null
    } catch {
      return null
    }
  }, 'Chrome DevTools endpoint', 15000)

  const targetsResponse = await fetch(`http://127.0.0.1:${portInfo.port}/json/list`)
  if (!targetsResponse.ok) throw new Error('Could not list Chromium page targets.')
  const targets = await targetsResponse.json()
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) throw new Error('Chromium did not expose a page target.')

  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome DevTools WebSocket connection timed out.')), 10000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chrome DevTools WebSocket connection failed.')) }, { once: true })
  })
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      if (!message.id) return
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      if (message.error) waiting.reject(new Error(message.error.message || 'Chrome DevTools error.'))
      else waiting.resolve(message.result || {})
    } catch {
      // Ignore non-response browser events.
    }
  })

  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.navigate', { url: siteUrl })

  const initialBanner = await waitFor(
    () => evaluate(`(() => {
      const banner = document.querySelector('section[aria-label="Настройки аналитики"]');
      return document.readyState === 'complete' && banner ? banner.innerText : '';
    })()`),
    'first-visit analytics consent banner',
  )
  if (!initialBanner.includes('Разрешить аналитику')) {
    throw new Error('The first-visit banner did not contain the analytics accept action.')
  }
  console.log('First-visit analytics consent banner appeared.')

  const clicked = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((item) => item.textContent.trim() === 'Разрешить аналитику');
    if (!button) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error('Could not find the analytics accept button.')

  const counterId = await waitFor(
    () => evaluate(`(() => {
      if (localStorage.getItem('bookblog-analytics-consent-v1') !== 'accepted') return '';
      return document.querySelector('script[data-yandex-metrika]')?.dataset.yandexMetrika || '';
    })()`),
    'saved acceptance and Yandex Metrika script injection',
  )
  if (!/^\d+$/.test(counterId)) {
    throw new Error('The accepted consent did not produce a numeric Yandex Metrika counter.')
  }
  console.log('Accept action persisted and the Yandex Metrika script was injected.')

  await command('Page.reload', { ignoreCache: true })
  const afterReload = await waitFor(
    () => evaluate(`(() => {
      const accepted = localStorage.getItem('bookblog-analytics-consent-v1') === 'accepted';
      const bannerVisible = Boolean(document.querySelector('section[aria-label="Настройки аналитики"]'));
      const scriptPresent = Boolean(document.querySelector('script[data-yandex-metrika]'));
      return document.readyState === 'complete' && accepted && !bannerVisible && scriptPresent;
    })()`),
    'accepted choice persisting after reload without showing the banner again',
  )
  if (!afterReload) throw new Error('Analytics consent was not retained after reload.')
  console.log('After reload the banner stayed hidden and the counter script remained enabled.')
} finally {
  if (socket && socket.readyState === WebSocket.OPEN) socket.close()
  chrome.kill('SIGTERM')
  await rm(profile, { recursive: true, force: true })
}
