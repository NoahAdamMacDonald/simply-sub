// Reads a page in Mullvad Browser, the third browser (M11.7, the guide's §3.2), running read-page.cjs's steps on one
// tab and saving what it sees the same way: <name>.txt (the URL, a blank line, the visible text) and <name>.png (the
// whole page). Playwright can't drive it, so this speaks WebDriver BiDi to the browser's own --remote-debugging-port on
// Node's built-in WebSocket, headless, with a throwaway profile deleted after: never the owner's, whose uBlock Origin and
// history stay theirs. See SKILL.md.
// Usage: node read-page-mullvad.cjs <output dir> <url> [step ...]
//
// Steps (as read-page.cjs's, but country:, which is Disney+'s picker):
//   wait:<ms>                     pause (every page load already waits LOAD_WAIT ms for scripts to render)
//   click:<text>                  click the first visible element whose whole visible text is <text>
//   click?:<text>                 the same, but carry on if it isn't there (cookie banners: "click?:Reject All")
//   nth:<n>:<text>                click the nth (from 1) element whose whole visible text is <text>, in page order:
//                                 one card's own tab where each card has one (Bitdefender's "nth:1:2 Years")
//   tab:<text>                    click the first role="tab" element whose visible text is <text>
//   select:<aria-label>=<value>   pick an option in a <select> by its aria-label
//   goto:<url>                    load another page in the same tab (keeps cookies and choices)
//   snap:<name>                   save <name>.txt and <name>.png
// With no snap step, the page is saved as page.txt / page.png at the end.
//
// It tells every site it's en-US in UTC, by design: use it for pages Edge can't reach and for policy pages, and for a
// price only once the page's currency is the region's (the guide's §3.2).
//
// Environment: MULLVAD_BROWSER (the executable; default %LOCALAPPDATA%\Mullvad\MullvadBrowser\Release\mullvadbrowser.exe),
// PORT (its debugging port, default 9230), LOAD_WAIT (ms after each load, default 6000).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [outDir, url, ...steps] = process.argv.slice(2);
if (!outDir || !url) {
  console.error('Usage: node read-page-mullvad.cjs <output dir> <url> [step ...]');
  process.exit(2);
}
const executable =
  process.env.MULLVAD_BROWSER ??
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'Mullvad',
    'MullvadBrowser',
    'Release',
    'mullvadbrowser.exe',
  );
const port = Number(process.env.PORT ?? 9230);
const loadWait = Number(process.env.LOAD_WAIT ?? 6000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** WebDriver BiDi over one WebSocket: each command answered by its id. */
class Bidi {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiting = message.id !== undefined && this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.type === 'error')
        waiting.reject(new Error(`${message.error}: ${message.message}`));
      else waiting.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.next;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

/** Connects to the browser's BiDi endpoint, trying until it listens (up to 30 s). */
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
    const opened = await new Promise((resolve) => {
      socket.addEventListener('open', () => resolve(true), { once: true });
      socket.addEventListener('error', () => resolve(false), { once: true });
    });
    if (opened) return socket;
    await sleep(500);
  }
  throw new Error(`Mullvad Browser didn't open its debugging port ${port}`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(executable)) {
    console.error(`No Mullvad Browser at ${executable}: set MULLVAD_BROWSER`);
    process.exit(2);
  }
  // A throwaway profile: no first-run pages, no update checks, nothing kept.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mullvad-reader-'));
  fs.writeFileSync(
    path.join(profile, 'user.js'),
    [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("app.update.auto", false);',
      'user_pref("app.update.enabled", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    ].join('\n'),
  );
  const browser = spawn(
    executable,
    ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port)],
    { stdio: 'ignore' },
  );
  let bidi;
  let context;
  let snapped = false;

  const evaluate = async (expression) => {
    const answer = await bidi.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
    });
    if (answer.type === 'exception') throw new Error(answer.exceptionDetails.text);
    return answer.result.value;
  };
  const navigate = async (to) => {
    await bidi.send('browsingContext.navigate', { context, url: to, wait: 'complete' });
    await sleep(loadWait);
  };
  const snap = async (name) => {
    const text = await evaluate('document.body.innerText');
    const where = await evaluate('location.href');
    fs.writeFileSync(path.join(outDir, `${name}.txt`), `${where}\n\n${text}`);
    const { data } = await bidi.send('browsingContext.captureScreenshot', {
      context,
      origin: 'document',
    });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`snap ${name}: ${text.length} chars, ${where} (Mullvad Browser)`);
  };
  /** Clicks the last visible element (of `selector`) whose whole visible text is `text`; false when there's none. */
  const clickText = (text, selector = '*') =>
    evaluate(`(() => {
      const wanted = ${JSON.stringify(text)};
      const found = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .reverse()
        .find((element) => element.offsetParent !== null && element.innerText?.trim() === wanted);
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    })()`);
  /**
   * Clicks the nth (from 1, in document order) innermost visible element whose whole visible text is `text`, one
   * holding no element with the same text; false when there's no such element.
   */
  const clickNth = (n, text) =>
    evaluate(`(() => {
      const wanted = ${JSON.stringify(text)};
      const shows = (element) => element.offsetParent !== null && element.innerText?.trim() === wanted;
      const found = [...document.querySelectorAll('*')].filter(
        (element) => shows(element) && ![...element.children].some(shows),
      )[${Number(n) - 1}];
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    })()`);

  try {
    bidi = new Bidi(await connect());
    await bidi.send('session.new', { capabilities: {} });
    const { contexts } = await bidi.send('browsingContext.getTree', {});
    context =
      contexts[0]?.context ?? (await bidi.send('browsingContext.create', { type: 'tab' })).context;
    await bidi.send('browsingContext.setViewport', {
      context,
      viewport: { width: 1400, height: 1000 },
    });
    await navigate(url);
    for (const step of steps) {
      const [kind, ...rest] = step.split(':');
      const arg = rest.join(':');
      switch (kind) {
        case 'wait':
          await sleep(Number(arg));
          break;
        case 'click':
          // The innermost element with the text: the last in document order, since a parent's text holds it too.
          if (!(await clickText(arg))) throw new Error(`Nothing shows "${arg}"`);
          await sleep(1500);
          break;
        case 'click?':
          if (await clickText(arg)) await sleep(1500);
          else console.log(`skip ${step}: not found`);
          break;
        case 'nth': {
          const [n, ...words] = arg.split(':');
          const text = words.join(':');
          if (!(await clickNth(n, text))) throw new Error(`No element ${n} showing "${text}"`);
          await sleep(1500);
          break;
        }
        case 'tab':
          if (!(await clickText(arg, '[role="tab"]'))) throw new Error(`No tab "${arg}"`);
          await sleep(2000);
          break;
        case 'select': {
          const [label, value] = arg.split('=');
          const picked = await evaluate(`(() => {
            const select = document.querySelector(${JSON.stringify(`select[aria-label="${label}"]`)});
            if (!select) return false;
            select.value = ${JSON.stringify(value)};
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          })()`);
          if (!picked) throw new Error(`No select "${label}"`);
          await sleep(2500);
          break;
        }
        case 'goto':
          await navigate(arg);
          break;
        case 'snap':
          await snap(arg);
          snapped = true;
          break;
        default:
          throw new Error(`Unknown step "${step}"`);
      }
    }
    if (!snapped) await snap('page');
  } catch (error) {
    console.error(`FAILED: ${error.message.split('\n')[0]}`);
    if (bidi && context) await snap('failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    await bidi?.send('session.end', {}).catch(() => {});
    // Its content processes are children: end the whole tree, then the throwaway profile.
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        browser.kill();
      }
    } catch {
      // already gone
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(500);
      }
    }
    process.exit();
  }
})();
