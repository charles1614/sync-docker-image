#!/usr/bin/env node
/**
 * sdi — command line client for the Docker image sync service.
 *
 * Triggers syncs through the web API using a token generated in the web UI,
 * and reports progress in a form that both humans and automation can read.
 * No runtime dependencies; Node 18+ only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

// ---------------------------------------------------------------------------
// Exit codes — stable, so scripts and agents can branch on them
// ---------------------------------------------------------------------------
const EXIT = {
  OK: 0,
  ERROR: 1, // network / server / auth failure
  USAGE: 2, // bad arguments
  JOB_FAILED: 3, // the sync itself failed
  TIMEOUT: 4, // --wait gave up before the job finished
};

const VERSION = readVersion();

function readVersion() {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), 'package.json');
    return JSON.parse(readFileSync(pkg, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG_DIR =
  process.env.SDI_CONFIG_DIR ||
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sync-docker-image');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // The file holds a bearer token, so keep it owner-readable only
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

function normalizeUrl(url) {
  if (!url) return url;
  let value = url.trim();
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  return value.replace(/\/+$/, '');
}

// Env beats config file, so CI can export SDI_URL / SDI_TOKEN without logging in
function resolveAuth(flags) {
  const config = readConfig();
  const url = normalizeUrl(flags.url || process.env.SDI_URL || config.url);
  const token = flags.token || process.env.SDI_TOKEN || config.token;
  return { url, token };
}

function requireAuth(flags) {
  const { url, token } = resolveAuth(flags);

  if (!url || !token) {
    throw new CliError(
      'Not logged in. Run `sdi login`, or set SDI_URL and SDI_TOKEN.',
      EXIT.USAGE
    );
  }

  return { url, token };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
class CliError extends Error {
  constructor(message, code = EXIT.ERROR) {
    super(message);
    this.code = code;
  }
}

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && !process.argv.includes('--no-color');

const color = {
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s) => (useColor ? `\x1b[34m${s}\x1b[0m` : s),
  cyan: (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const STATUS_COLOR = {
  pending: color.yellow,
  running: color.blue,
  success: color.green,
  failed: color.red,
};

// In --json mode stdout carries only the JSON document, so human-readable
// chatter goes to stderr and stays pipeable into jq.
let jsonMode = false;
let quiet = false;

function info(...args) {
  if (quiet) return;
  const stream = jsonMode ? process.stderr : process.stdout;
  stream.write(args.join(' ') + '\n');
}

function warn(...args) {
  process.stderr.write(args.join(' ') + '\n');
}

function emitJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const BOOLEAN_FLAGS = new Set([
  'wait',
  'json',
  'pull',
  'yes',
  'quiet',
  'help',
  'version',
  'no-color',
  'token-stdin',
  'all',
]);

const ALIASES = {
  w: 'wait',
  y: 'yes',
  q: 'quiet',
  h: 'help',
  v: 'version',
  n: 'limit',
  s: 'status',
};

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }

    let name;
    let inlineValue;

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) inlineValue = arg.slice(eq + 1);
    } else {
      const short = arg.slice(1);
      name = ALIASES[short] || short;
    }

    name = ALIASES[name] || name;

    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = inlineValue === undefined ? true : inlineValue !== 'false';
      continue;
    }

    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('-') && next !== '-')) {
      throw new CliError(`Flag --${name} expects a value`, EXIT.USAGE);
    }

    flags[name] = next;
    i++;
  }

  return { positional, flags };
}

function intFlag(flags, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (flags[name] === undefined) return fallback;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new CliError(`--${name} must be an integer between ${min} and ${max}`, EXIT.USAGE);
  }
  return value;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function api(baseUrl, token, path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  let response;

  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': `sdi-cli/${VERSION}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new CliError(`Request to ${baseUrl} timed out after ${timeoutMs / 1000}s`);
    }
    throw new CliError(`Cannot reach ${baseUrl}: ${error.message}`);
  }

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body means we hit something other than the API (a login page,
    // a proxy error). Say so rather than dumping HTML at the user.
    throw new CliError(
      `Unexpected non-JSON response (HTTP ${response.status}) from ${baseUrl}${path}. ` +
        'Check that the URL points at the sync web app.'
    );
  }

  if (!response.ok || payload.success === false) {
    const message = payload.error || `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new CliError(`${message}. Run \`sdi login\` to authenticate again.`);
    }
    if (response.status === 403) {
      throw new CliError(message);
    }
    if (response.status === 429) {
      throw new CliError(`${message} (rate limited)`);
    }

    throw new CliError(message);
  }

  return payload.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Older jobs stored the registry separately from the repo path; newer ones
// store the full URL. Handle both, like the web UI does.
function fullDestination(job) {
  if (!job) return '';
  if (/\.[^/]+\//.test(job.destination_repo)) return job.destination_repo;
  return `${job.destination_registry}/${job.destination_repo}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prompt(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Read a secret without echoing it back to the terminal
function promptSecret(query) {
  if (!process.stdin.isTTY) return prompt(query);

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });

    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };

    rl.question(query, (answer) => {
      muted = false;
      rl.output.write('\n');
      rl.close();
      resolve(answer.trim());
    });

    muted = true;
  });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

async function confirm(question, { yes }) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    throw new CliError('Refusing to continue without confirmation. Pass -y to skip.', EXIT.USAGE);
  }
  const answer = await prompt(`${question} [y/N] `);
  return /^y(es)?$/i.test(answer);
}

function renderTable(headers, rows) {
  if (rows.length === 0) return '';

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(String(row[i] ?? '')).length))
  );

  const line = (cells, pad) =>
    cells
      .map((cell, i) => {
        const text = String(cell ?? '');
        return text + ' '.repeat(Math.max(0, widths[i] - stripAnsi(text).length));
      })
      .join(pad)
      .trimEnd();

  return [
    color.dim(line(headers, '  ')),
    ...rows.map((row) => line(row, '  ')),
  ].join('\n');
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class ProgressLine {
  constructor() {
    this.interactive = process.stderr.isTTY && !quiet && !jsonMode;
    this.frame = 0;
    this.lastPlain = '';
    this.width = 0;
  }

  // `detail` is the part worth logging; `suffix` is decoration such as elapsed
  // time, which changes every tick and would otherwise spam non-TTY logs.
  update(detail, suffix = '') {
    if (this.interactive) {
      const frame = SPINNER[this.frame++ % SPINNER.length];
      const line = `${color.cyan(frame)} ${detail}${suffix}`;
      // Pad to the previous width so shorter lines do not leave debris
      const padding = ' '.repeat(Math.max(0, this.width - stripAnsi(line).length));
      process.stderr.write(`\r${line}${padding}`);
      this.width = stripAnsi(line).length;
      return;
    }

    // Non-interactive: only speak up when the step itself changed
    if (detail !== this.lastPlain && !quiet && !jsonMode) {
      process.stderr.write(detail + '\n');
      this.lastPlain = detail;
    }
  }

  clear() {
    if (this.interactive && this.width > 0) {
      process.stderr.write('\r' + ' '.repeat(this.width) + '\r');
      this.width = 0;
    }
  }
}

/**
 * Poll a job until it reaches a terminal state.
 * Returns { job, progress, timedOut }.
 */
async function waitForJob(url, token, jobId, { intervalMs, timeoutMs }) {
  const started = Date.now();
  const line = new ProgressLine();
  let last = null;

  while (true) {
    const data = await api(url, token, `/syncs/${jobId}?progress=1`);
    last = data;

    const { job, progress } = data;

    if (job.status === 'success' || job.status === 'failed') {
      line.clear();
      return { job, progress, timedOut: false };
    }

    const elapsed = formatDuration(Date.now() - started);
    const step = progress?.current_step;
    const counter =
      progress && progress.total_steps > 0
        ? ` (${progress.completed_steps}/${progress.total_steps})`
        : '';
    const detail = step ? `${step}${counter}` : job.status;

    line.update(detail, ` ${color.dim(`· ${elapsed}`)}`);

    if (Date.now() - started >= timeoutMs) {
      line.clear();
      return { job: last.job, progress: last.progress, timedOut: true };
    }

    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdLogin(positional, flags) {
  const config = readConfig();

  let url = normalizeUrl(flags.url || positional[0] || process.env.SDI_URL || config.url);

  if (!url) {
    url = normalizeUrl(await prompt('Web app URL (e.g. https://your-app.vercel.app): '));
  }

  if (!url) {
    throw new CliError('A web app URL is required', EXIT.USAGE);
  }

  let token = flags.token || process.env.SDI_TOKEN;

  if (!token && flags['token-stdin']) {
    token = await readStdin();
  }

  if (!token) {
    warn(color.dim(`Generate a token at ${url}/tokens`));
    token = await promptSecret('API token (sdi_...): ');
  }

  if (!token) {
    throw new CliError('An API token is required', EXIT.USAGE);
  }

  // Fail here rather than on the first real command
  const { user } = await api(url, token, '/auth/me');

  writeConfig({ ...config, url, token });

  info(color.green('✓'), `Logged in to ${url}`);
  info(color.dim(`  user ${user.id}${user.email ? ` (${user.email})` : ''}`));
  info(color.dim(`  credentials saved to ${CONFIG_FILE}`));

  if (jsonMode) emitJson({ url, user, config_file: CONFIG_FILE });
}

async function cmdLogout() {
  if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
    info(color.green('✓'), 'Logged out');
  } else {
    info('Not logged in');
  }
  if (jsonMode) emitJson({ logged_out: true });
}

async function cmdWhoami(positional, flags) {
  const { url, token } = requireAuth(flags);
  const { user } = await api(url, token, '/auth/me');

  if (jsonMode) return emitJson({ url, user });

  info(`${color.bold('URL')}    ${url}`);
  info(`${color.bold('User')}   ${user.id}${user.email ? ` (${user.email})` : ''}`);
  info(`${color.bold('Auth')}   ${user.auth_mode === 'token' ? 'API token' : 'browser session'}`);
}

async function cmdConfig(positional, flags) {
  const config = readConfig();
  const { url, token } = resolveAuth(flags);
  const redacted = token ? `${token.slice(0, 12)}…` : null;

  if (jsonMode) {
    return emitJson({ config_file: CONFIG_FILE, url: url || null, token: redacted });
  }

  info(`${color.bold('Config file')}  ${CONFIG_FILE}${existsSync(CONFIG_FILE) ? '' : color.dim(' (not created yet)')}`);
  info(`${color.bold('URL')}          ${url || color.dim('(unset)')}`);
  info(`${color.bold('Token')}        ${redacted || color.dim('(unset)')}`);

  if (process.env.SDI_URL && process.env.SDI_URL !== config.url) {
    info(color.dim('  URL comes from $SDI_URL'));
  }
  if (process.env.SDI_TOKEN && process.env.SDI_TOKEN !== config.token) {
    info(color.dim('  Token comes from $SDI_TOKEN'));
  }
}

async function cmdCreate(workflowType, positional, flags) {
  const { url, token } = requireAuth(flags);

  const source = positional[0];
  const destination = positional[1] || flags.dest || flags.destination;

  if (!source) {
    throw new CliError(`Usage: sdi ${workflowType} <source-image> [destination]`, EXIT.USAGE);
  }

  const intervalMs = intFlag(flags, 'interval', 5, { min: 1, max: 300 }) * 1000;
  const timeoutMs = intFlag(flags, 'timeout', 1800, { min: 10, max: 21600 }) * 1000;

  info(color.dim(`Triggering ${workflowType} for ${source}…`));

  // The server waits for the GitHub run to appear before answering,
  // so this call is deliberately slow.
  const { job } = await api(url, token, '/syncs', {
    method: 'POST',
    body: {
      source_image: source,
      destination_image: destination,
      workflow_type: workflowType,
    },
    timeoutMs: 90000,
  });

  const target = fullDestination(job);

  info(color.green('✓'), `Job ${color.bold(job.id)} started`);
  info(color.dim(`  ${job.source_repo} → ${target}`));
  if (job.github_run_id) info(color.dim(`  run ${job.github_run_id}`));

  if (!flags.wait) {
    if (jsonMode) emitJson({ job, destination: target });
    else info(color.dim(`\nFollow it with: sdi status ${job.id} --wait`));
    return EXIT.OK;
  }

  const result = await waitForJob(url, token, job.id, { intervalMs, timeoutMs });

  return finishJob(result, { destination: target, pull: flags.pull });
}

async function cmdStatus(positional, flags) {
  const { url, token } = requireAuth(flags);
  const jobId = positional[0];

  if (!jobId) {
    throw new CliError('Usage: sdi status <job-id> [--wait]', EXIT.USAGE);
  }

  const intervalMs = intFlag(flags, 'interval', 5, { min: 1, max: 300 }) * 1000;
  const timeoutMs = intFlag(flags, 'timeout', 1800, { min: 10, max: 21600 }) * 1000;

  if (flags.wait) {
    const result = await waitForJob(url, token, jobId, { intervalMs, timeoutMs });
    return finishJob(result, { destination: fullDestination(result.job), pull: flags.pull });
  }

  const { job, progress } = await api(url, token, `/syncs/${jobId}?progress=1`);

  if (jsonMode) return emitJson({ job, progress, destination: fullDestination(job) });

  printJobDetail(job, progress);
  return job.status === 'failed' ? EXIT.JOB_FAILED : EXIT.OK;
}

function printJobDetail(job, progress) {
  const paint = STATUS_COLOR[job.status] || ((s) => s);

  info(`${color.bold('Job')}          ${job.id}`);
  info(`${color.bold('Status')}       ${paint(job.status)}${job.conclusion ? color.dim(` (${job.conclusion})`) : ''}`);
  info(`${color.bold('Type')}         ${job.workflow_type}`);
  info(`${color.bold('Source')}       ${job.source_repo}`);
  info(`${color.bold('Destination')}  ${fullDestination(job)}`);
  info(`${color.bold('Created')}      ${new Date(job.created_at).toLocaleString()}`);
  if (job.logs_url) info(`${color.bold('Logs')}         ${job.logs_url}`);
  if (job.error_message) info(`${color.bold('Error')}        ${color.red(job.error_message)}`);

  if (progress?.steps?.length) {
    info('');
    info(color.dim(`Steps (${progress.completed_steps}/${progress.total_steps})`));
    for (const step of progress.steps) {
      const mark =
        step.status !== 'completed'
          ? color.blue('•')
          : step.conclusion === 'success'
            ? color.green('✓')
            : step.conclusion === 'skipped'
              ? color.dim('–')
              : color.red('✗');
      info(`  ${mark} ${step.name}`);
    }
  }
}

// Shared tail end of copy/sync/status --wait
async function finishJob({ job, progress, timedOut }, { destination, pull }) {
  if (timedOut) {
    if (jsonMode) emitJson({ job, progress, destination, timed_out: true });
    else warn(color.yellow('!'), `Timed out waiting for job ${job.id} (it is still running)`);
    return EXIT.TIMEOUT;
  }

  if (job.status === 'failed') {
    if (jsonMode) emitJson({ job, progress, destination });
    else {
      warn(color.red('✗'), `Sync failed${job.conclusion ? ` (${job.conclusion})` : ''}`);
      if (job.logs_url) warn(color.dim(`  logs: ${job.logs_url}`));
    }
    return EXIT.JOB_FAILED;
  }

  info(color.green('✓'), `Sync complete: ${color.bold(destination)}`);

  if (pull && job.workflow_type === 'sync') {
    // A sync job copies every tag, so there is no single image to pull
    warn(color.yellow('!'), '--pull is ignored for `sdi sync` (it copies every tag)');
  } else if (pull) {
    const code = await dockerPull(destination);
    if (code !== 0) {
      if (jsonMode) emitJson({ job, progress, destination, pulled: false });
      return EXIT.ERROR;
    }
  }

  if (jsonMode) {
    emitJson({ job, progress, destination, pulled: Boolean(pull) && job.workflow_type !== 'sync' });
  }
  return EXIT.OK;
}

function dockerPull(image) {
  info(color.dim(`Pulling ${image}…`));

  return new Promise((resolve) => {
    const child = spawn('docker', ['pull', image], { stdio: 'inherit' });
    child.on('error', (error) => {
      warn(color.red('✗'), `docker pull failed: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function cmdList(positional, flags) {
  const { url, token } = requireAuth(flags);

  const limit = intFlag(flags, 'limit', 10, { min: 1, max: 100 });
  const page = intFlag(flags, 'page', 1, { min: 1, max: 10000 });

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String((page - 1) * limit),
  });

  if (flags.status) params.set('status', flags.status);
  if (flags.search) params.set('search', flags.search);

  const data = await api(url, token, `/syncs?${params}`);

  if (jsonMode) return emitJson(data);

  if (data.jobs.length === 0) {
    info('No sync jobs found');
    return EXIT.OK;
  }

  const rows = data.jobs.map((job) => {
    const paint = STATUS_COLOR[job.status] || ((s) => s);
    return [
      job.id.slice(0, 8),
      paint(job.status),
      job.workflow_type,
      job.source_repo,
      fullDestination(job),
      new Date(job.created_at).toLocaleString(),
    ];
  });

  info(renderTable(['ID', 'STATUS', 'TYPE', 'SOURCE', 'DESTINATION', 'CREATED'], rows));

  const shown = (page - 1) * limit + data.jobs.length;
  info('');
  info(color.dim(`Showing ${shown} of ${data.total} · page ${page}`));

  return EXIT.OK;
}

async function cmdRemove(positional, flags) {
  const { url, token } = requireAuth(flags);

  if (positional.length === 0) {
    throw new CliError('Usage: sdi rm <job-id> [job-id...]', EXIT.USAGE);
  }

  const noun = positional.length === 1 ? 'job' : `${positional.length} jobs`;
  if (!(await confirm(`Delete ${noun}?`, { yes: flags.yes }))) {
    info('Aborted');
    return EXIT.OK;
  }

  const deleted = [];
  const failed = [];

  for (const id of positional) {
    try {
      await api(url, token, `/syncs/${id}`, { method: 'DELETE' });
      deleted.push(id);
      if (!jsonMode) info(color.green('✓'), `Deleted ${id}`);
    } catch (error) {
      failed.push({ id, error: error.message });
      warn(color.red('✗'), `${id}: ${error.message}`);
    }
  }

  if (jsonMode) emitJson({ deleted, failed });
  return failed.length > 0 ? EXIT.ERROR : EXIT.OK;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
const HELP = `${color.bold('sdi')} — sync Docker images to your registry from the command line

${color.bold('USAGE')}
  sdi <command> [arguments] [flags]

${color.bold('COMMANDS')}
  login [url]              Save the web app URL and an API token
  logout                   Forget the saved credentials
  whoami                   Show who the current token belongs to
  config                   Show the resolved configuration

  copy <source> [dest]     Sync a single tag
  sync <source> [dest]     Sync every tag of a repository
  status <job-id>          Show a job's status and step-by-step progress
  list                     List recent jobs
  rm <job-id>...           Delete jobs

${color.bold('FLAGS')}
  -w, --wait               Block until the job finishes
      --timeout <seconds>  Give up waiting after this long (default 1800)
      --interval <seconds> Poll interval while waiting (default 5)
      --pull               Run \`docker pull\` on the result after a successful sync
      --json               Emit JSON on stdout; human output goes to stderr
  -s, --status <status>    list: filter by pending|running|success|failed
      --search <text>      list: filter by source image name
  -n, --limit <n>          list: results per page (default 10)
      --page <n>           list: page number (default 1)
  -y, --yes                Skip confirmation prompts
  -q, --quiet              Suppress non-essential output
      --url <url>          Override the configured web app URL
      --token <token>      Override the configured API token
      --no-color           Disable coloured output
  -h, --help               Show this help
  -v, --version            Show the version

${color.bold('ENVIRONMENT')}
  SDI_URL                  Web app URL (overrides the config file)
  SDI_TOKEN                API token (overrides the config file)
  SDI_CONFIG_DIR           Directory holding config.json

${color.bold('EXIT CODES')}
  0 success   1 error   2 bad usage   3 sync failed   4 timed out waiting

${color.bold('EXAMPLES')}
  ${color.dim('# Log in once; the token comes from the web UI at <url>/tokens')}
  sdi login https://your-app.vercel.app

  ${color.dim('# Destination defaults to the registry/namespace configured server-side')}
  sdi copy nginx:1.27
  sdi copy ghcr.io/owner/app:v1 team/app:v1 --wait

  ${color.dim('# Wait for completion, then pull the synced image locally')}
  sdi copy nvcr.io/nvidia/pytorch:24.05-py3 --wait --pull

  ${color.dim('# Machine-readable output for scripts and agents')}
  sdi copy redis:7 --wait --json | jq -r '.destination'
  sdi list --status failed --json
`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(argv) {
  const { positional, flags } = parseArgs(argv);

  jsonMode = Boolean(flags.json);
  quiet = Boolean(flags.quiet);

  const command = positional.shift();

  if (flags.version || command === 'version') {
    process.stdout.write(`sdi ${VERSION}\n`);
    return EXIT.OK;
  }

  if (!command || flags.help || command === 'help') {
    process.stdout.write(HELP);
    return command || flags.help ? EXIT.OK : EXIT.USAGE;
  }

  switch (command) {
    case 'login':
      return (await cmdLogin(positional, flags)) ?? EXIT.OK;
    case 'logout':
      return (await cmdLogout(positional, flags)) ?? EXIT.OK;
    case 'whoami':
      return (await cmdWhoami(positional, flags)) ?? EXIT.OK;
    case 'config':
      return (await cmdConfig(positional, flags)) ?? EXIT.OK;
    case 'copy':
      return (await cmdCreate('copy', positional, flags)) ?? EXIT.OK;
    case 'sync':
      return (await cmdCreate('sync', positional, flags)) ?? EXIT.OK;
    case 'status':
      return (await cmdStatus(positional, flags)) ?? EXIT.OK;
    case 'list':
    case 'ls':
      return (await cmdList(positional, flags)) ?? EXIT.OK;
    case 'rm':
    case 'delete':
      return (await cmdRemove(positional, flags)) ?? EXIT.OK;
    default:
      throw new CliError(`Unknown command: ${command}. Run \`sdi help\`.`, EXIT.USAGE);
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code ?? EXIT.OK;
  })
  .catch((error) => {
    if (error instanceof CliError) {
      warn(color.red('error:'), error.message);
      process.exitCode = error.code;
      return;
    }
    warn(color.red('error:'), error?.stack || String(error));
    process.exitCode = EXIT.ERROR;
  });
