// Grocery Shopper: a small local web page that hands your grocery list to
// Claude Code in a Chrome window on this computer. Claude looks up prices at
// Walmart and Sam's Club, plan.js picks the cheaper store for each item, and
// Claude then fills both carts. Start it with `npm run shop`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { buildPlan, cartInstructions } = require('./plan.js');

const PORT = Number(process.env.PORT) || 4321;
const HERE = __dirname;
const PROFILE_DIR = path.join(HERE, '.chrome-profile');
const MCP_CONFIG = '.mcp.generated.json';
const isWindows = process.platform === 'win32';

let current = null; // the running Claude Code process, if any
let loginChild = null; // the sign-in Chrome window, if open
let loginError = ''; // why the last sign-in window failed to open, if it did
let lastActivity = Date.now();

// The Mac app starts this server in the background. It quits by itself after
// a stretch with no page activity so it doesn't linger forever.
const IDLE_EXIT_MINUTES = Number(process.env.SHOPPER_IDLE_EXIT_MINUTES) || 0;
if (IDLE_EXIT_MINUTES) {
  setInterval(() => {
    if (!current && !loginChild && Date.now() - lastActivity > IDLE_EXIT_MINUTES * 60000) process.exit(0);
  }, 60000).unref();
}

function writeMcpConfig() {
  const config = {
    mcpServers: {
      playwright: {
        command: isWindows ? 'cmd' : 'npx',
        args: [
          ...(isWindows ? ['/c', 'npx'] : []),
          '-y', '@playwright/mcp@0.0.82', '--browser', 'chrome', '--user-data-dir', PROFILE_DIR,
        ],
      },
    },
  };
  fs.writeFileSync(path.join(HERE, MCP_CONFIG), JSON.stringify(config, null, 2));
}

function fillTemplate(file, values) {
  const template = fs.readFileSync(path.join(HERE, file), 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in values ? values[key] : m));
}

const FRIENDLY = {
  browser_navigate: (i) => `Opening ${i.url}`,
  browser_click: (i) => `Clicking ${i.element || 'the page'}`,
  browser_type: (i) => `Typing "${i.text}"`,
  browser_snapshot: () => 'Reading the page',
  browser_wait_for: () => 'Waiting for the page',
  browser_press_key: (i) => `Pressing ${i.key}`,
  browser_tabs: () => 'Switching tabs',
  browser_navigate_back: () => 'Going back',
  browser_select_option: (i) => `Choosing ${i.element || 'an option'}`,
  browser_take_screenshot: () => 'Looking at the page',
};

function describeTool(name, input) {
  const short = name.replace(/^mcp__playwright__/, '');
  const fn = FRIENDLY[short];
  try {
    return fn ? fn(input || {}) : short.replace(/^browser_/, '').replace(/_/g, ' ');
  } catch (e) {
    return short;
  }
}

function extractJson(text) {
  const blocks = [...String(text || '').matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(blocks[i][1]);
    } catch (e) {
      /* try the previous block */
    }
  }
  return null;
}

function stopCurrent() {
  if (!current) return;
  const child = current;
  if (isWindows) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGTERM');
}

/**
 * Runs one Claude Code turn with only the browser tool, streaming its steps
 * to `send`. Resolves to { text, sessionId } or rejects with a readable error.
 */
function runClaude(prompt, send, resumeId) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--mcp-config', MCP_CONFIG,
      '--strict-mcp-config',
      '--allowedTools', 'mcp__playwright',
    ];
    if (resumeId) args.push('--resume', resumeId);
    // The prompt goes in through stdin so newlines and quotes survive on every OS.
    const child = spawn('claude', args, { cwd: HERE, shell: isWindows, stdio: ['pipe', 'pipe', 'pipe'] });
    current = child;
    child.stdin.end(prompt);

    let buffer = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          continue;
        }
        handle(msg);
      }
    });

    function handle(msg) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        const pw = (msg.mcp_servers || []).find((sv) => sv.name === 'playwright');
        if (pw && pw.status !== 'connected') {
          finish(reject, new Error(`The browser tool didn't start (status: ${pw.status}). Make sure Google Chrome is installed, then try again.`));
          stopCurrent();
        }
      } else if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        for (const part of msg.message.content) {
          if (part.type === 'tool_use') send({ kind: 'step', text: describeTool(part.name, part.input) });
          else if (part.type === 'text' && part.text.trim()) {
            const text = part.text.replace(/```json[\s\S]*?```/g, '').trim();
            if (text) send({ kind: 'say', text, attention: /ACTION NEEDED/i.test(text) });
          }
        }
      } else if (msg.type === 'result') {
        if (msg.is_error) finish(reject, new Error(msg.result || 'Claude Code reported an error.'));
        else finish(resolve, { text: msg.result || '', sessionId: msg.session_id });
      }
    }

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      finish(reject, new Error(err.code === 'ENOENT'
        ? "Couldn't find the `claude` command. Check that Claude Code is installed and that `claude --version` works in a terminal."
        : `Couldn't start Claude Code: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      if (current === child) current = null;
      const why = signal || code === null ? 'Stopped.' : `Claude Code exited early (code ${code}).`;
      finish(reject, new Error([why, stderr.trim().split('\n').slice(-5).join('\n')].filter(Boolean).join('\n')));
    });
  });
}

async function shop(req, res, body) {
  if (current || loginChild) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: current
        ? 'A shopping run is already going. Stop it first.'
        : 'Close the sign-in Chrome window first, then click Shop again.',
    }));
    return;
  }
  const list = String(body.list || '');
  if (!list.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Your list is empty.' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
  let open = true;
  const send = (event) => {
    if (open) res.write(JSON.stringify(event) + '\n');
  };
  // Stop Claude if the page is closed mid-run.
  res.on('close', () => {
    open = false;
    stopCurrent();
  });

  writeMcpConfig();
  try {
    send({ kind: 'status', text: 'Step 1 of 2: checking prices at both stores…' });
    const gathered = await runClaude(
      fillTemplate('gather.md', { LIST: list.trim(), NOTES: String(body.notes || '').trim() || 'None.' }),
      send,
    );
    if (!open) return;
    const prices = extractJson(gathered.text);
    if (!prices || !Array.isArray(prices.items)) {
      throw new Error("Claude didn't return prices in the expected format. Here's what it said:\n\n" + gathered.text.slice(0, 1500));
    }

    const plan = buildPlan(prices, body.settings);
    send({ kind: 'plan', plan });
    if (!plan.lines.length) {
      send({ kind: 'done', ok: true, report: null });
      return;
    }

    send({ kind: 'status', text: 'Step 2 of 2: adding items to your carts…' });
    const filled = await runClaude(
      fillTemplate('fill.md', { PLAN: cartInstructions(plan) }),
      send,
      gathered.sessionId,
    );
    send({ kind: 'done', ok: true, report: extractJson(filled.text), text: filled.text });
  } catch (err) {
    send({ kind: 'error', text: err.message });
  } finally {
    if (open) res.end();
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 100000) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function startLogin(res) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (current) return reply(409, { error: 'Wait for the shopping run to finish, or stop it, before signing in.' });
  if (loginChild) return reply(200, { ok: true });
  const child = spawn(process.execPath, [path.join(HERE, 'login.js')], { cwd: HERE, stdio: ['ignore', 'ignore', 'pipe'] });
  loginChild = child;
  loginError = '';
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (code) => {
    if (loginChild === child) loginChild = null;
    if (code) {
      console.error(stderr.trim());
      loginError = stderr.trim().split('\n')[0] || "Couldn't open Google Chrome.";
    }
  });
  child.on('error', () => { if (loginChild === child) loginChild = null; });
  reply(200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  // Only answer this computer's own page, never other websites.
  const host = req.headers.host || '';
  if (host !== `localhost:${PORT}` && host !== `127.0.0.1:${PORT}`) {
    res.writeHead(403);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(HERE, 'page.html')));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      signedInBefore: fs.existsSync(path.join(PROFILE_DIR, '.signed-in')),
      signingIn: Boolean(loginChild),
      signInError: loginError,
      shopping: Boolean(current),
    }));
    return;
  }

  if (req.method === 'POST' && ['/api/shop', '/api/stop', '/api/login'].includes(req.url)) {
    // A JSON content type forces a CORS preflight, which this server never
    // approves, so other sites can't start or stop a run.
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      res.writeHead(415);
      res.end();
      return;
    }
    if (req.url === '/api/login') {
      startLogin(res);
      return;
    }
    if (req.url === '/api/stop') {
      stopCurrent();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400);
      res.end();
      return;
    }
    shop(req, res, body);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Grocery Shopper is running at ${url}`);
  console.log('Keep this window open while you shop. Press Ctrl+C to quit.');
  if (!fs.existsSync(path.join(PROFILE_DIR, '.signed-in'))) {
    console.log('\nFirst time? Click "Sign in to stores" on the page.');
  }
  const opener = isWindows ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(opener[0], opener[1], () => {});
});

process.on('SIGINT', () => {
  stopCurrent();
  process.exit(0);
});
