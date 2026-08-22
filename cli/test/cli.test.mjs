/**
 * End-to-end tests for the sdi CLI.
 *
 * The CLI is spawned as a real subprocess against a scripted HTTP server, so
 * these cover what actually matters to callers: the exit-code contract, the
 * stdout/stderr split in --json mode, and the failure paths. Pure unit tests
 * would not catch a regression in any of those.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'sdi.js');
const TOKEN = 'sdi_' + 'A'.repeat(43);

const EXIT = { OK: 0, ERROR: 1, USAGE: 2, JOB_FAILED: 3, TIMEOUT: 4 };

const BASE_JOB = {
  id: 'job-1',
  workflow_type: 'copy',
  source_registry: 'docker.io',
  source_repo: 'nginx:1.27',
  destination_registry: 'registry.example.com',
  destination_repo: 'registry.example.com/team/nginx:1.27',
  github_run_id: '42',
  created_at: '2026-01-01T00:00:00.000Z',
  logs_url: 'https://github.com/o/r/actions/runs/42',
};

function progressFor(done) {
  return {
    status: done ? 'completed' : 'in_progress',
    conclusion: done ? 'success' : null,
    html_url: BASE_JOB.logs_url,
    steps: [{ name: 'Copy image', status: done ? 'completed' : 'in_progress', conclusion: done ? 'success' : null, number: 1 }],
    current_step: done ? null : 'Copy image',
    completed_steps: done ? 1 : 0,
    total_steps: 1,
  };
}

// Start a server whose behaviour is supplied per test. `respond` receives
// ({ url, method, body, hits }) and returns [status, payload] or a raw string.
async function withServer(respond, fn) {
  let hits = 0;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits++;
      const url = new URL(req.url, 'http://localhost');
      const auth = req.headers.authorization;

      if (auth !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Invalid or expired token' }));
      }

      const out = respond({ url, method: req.method, body: body ? JSON.parse(body) : null, hits });
      const [status, payload, raw] = out;

      res.writeHead(status, { 'content-type': raw ? 'text/html' : 'application/json' });
      res.end(raw ? payload : JSON.stringify(payload));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    return await fn(url);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function run(args, { env = {}, configDir } = {}) {
  const dir = configDir ?? mkdtempSync(join(tmpdir(), 'sdi-test-'));

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, SDI_CONFIG_DIR: dir, NO_COLOR: '1', ...env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr, configDir: dir }));
  });
}

const authed = (url) => ({ env: { SDI_URL: url, SDI_TOKEN: TOKEN } });

describe('argument handling', () => {
  test('--version prints the version and exits 0', async () => {
    const r = await run(['--version']);
    assert.equal(r.code, EXIT.OK);
    assert.match(r.stdout, /^sdi \d+\.\d+\.\d+/);
  });

  test('no arguments is a usage error', async () => {
    const r = await run([]);
    assert.equal(r.code, EXIT.USAGE);
  });

  test('explicit help exits 0', async () => {
    const r = await run(['help']);
    assert.equal(r.code, EXIT.OK);
    assert.match(r.stdout, /EXIT CODES/);
  });

  test('unknown command is a usage error', async () => {
    const r = await run(['frobnicate']);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /Unknown command/);
  });

  test('non-integer numeric flag is a usage error', async () => {
    const r = await run(['list', '--limit', 'abc']);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /--limit must be an integer/);
  });

  test('out-of-range numeric flag is a usage error', async () => {
    const r = await run(['list', '--limit', '9999']);
    assert.equal(r.code, EXIT.USAGE);
  });

  test('a flag missing its value is a usage error', async () => {
    const r = await run(['list', '--search']);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /expects a value/);
  });

  test('missing credentials is a usage error, not a crash', async () => {
    const r = await run(['list'], { env: { SDI_URL: '', SDI_TOKEN: '' } });
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /Not logged in/);
  });

  test('copy without a source is a usage error', async () => {
    const r = await run(['copy'], authed('http://127.0.0.1:1'));
    assert.equal(r.code, EXIT.USAGE);
  });
});

describe('authentication', () => {
  test('login stores credentials with owner-only permissions', async () => {
    await withServer(() => [200, { success: true, data: { user: { id: 'u1', auth_mode: 'token' } } }], async (url) => {
      const r = await run(['login', '--url', url, '--token', TOKEN]);
      assert.equal(r.code, EXIT.OK);

      const file = join(r.configDir, 'config.json');
      assert.ok(existsSync(file));
      assert.equal(statSync(file).mode & 0o777, 0o600, 'config must not be group/world readable');
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, TOKEN);
    });
  });

  test('logout removes the stored credentials', async () => {
    await withServer(() => [200, { success: true, data: { user: { id: 'u1' } } }], async (url) => {
      const first = await run(['login', '--url', url, '--token', TOKEN]);
      const r = await run(['logout'], { configDir: first.configDir });
      assert.equal(r.code, EXIT.OK);
      assert.ok(!existsSync(join(first.configDir, 'config.json')));
    });
  });

  test('a rejected token exits 1 and suggests re-authenticating', async () => {
    await withServer(() => [200, { success: true, data: {} }], async (url) => {
      const r = await run(['whoami'], { env: { SDI_URL: url, SDI_TOKEN: 'sdi_wrong' } });
      assert.equal(r.code, EXIT.ERROR);
      assert.match(r.stderr, /sdi login/);
    });
  });
});

describe('transport failures', () => {
  test('an unreachable host exits 1 with a clear message', async () => {
    const r = await run(['list'], authed('http://127.0.0.1:1'));
    assert.equal(r.code, EXIT.ERROR);
    assert.match(r.stderr, /Cannot reach/);
  });

  // Regression: api() used to return payload.data unchecked, so a 200 without
  // a data field surfaced as an unhandled TypeError plus a stack trace.
  test('a 200 with no data field reports a malformed response, not a TypeError', async () => {
    await withServer(() => [200, {}], async (url) => {
      const r = await run(['whoami'], authed(url));
      assert.equal(r.code, EXIT.ERROR);
      assert.match(r.stderr, /Malformed response/);
      assert.doesNotMatch(r.stderr, /TypeError/);
    });
  });

  // Regression: a gateway timeout used to be reported as a wrong-URL problem.
  test('a 5xx is reported as a server error, not a bad URL', async () => {
    await withServer(() => [504, '<html>Gateway Timeout</html>', true], async (url) => {
      const r = await run(['list'], authed(url));
      assert.equal(r.code, EXIT.ERROR);
      assert.match(r.stderr, /server error/i);
      assert.doesNotMatch(r.stderr, /points at the sync web app/);
    });
  });

  test('a non-JSON 200 still reports a wrong URL', async () => {
    await withServer(() => [200, '<html>login page</html>', true], async (url) => {
      const r = await run(['list'], authed(url));
      assert.equal(r.code, EXIT.ERROR);
      assert.match(r.stderr, /points at the sync web app/);
    });
  });
});

describe('sync lifecycle', () => {
  const routes = (jobFor) => ({ url, method, hits }) => {
    if (url.pathname === '/api/auth/me') return [200, { success: true, data: { user: { id: 'u1' } } }];
    if (url.pathname === '/api/syncs' && method === 'POST') {
      return [201, { success: true, data: { job: { ...BASE_JOB, status: 'running' } } }];
    }
    if (url.pathname === '/api/syncs' && method === 'GET') {
      return [200, { success: true, data: { jobs: [{ ...BASE_JOB, status: 'success' }], total: 1 } }];
    }
    if (url.pathname.startsWith('/api/syncs/') && method === 'DELETE') {
      return [200, { success: true, data: { message: 'deleted' } }];
    }
    if (url.pathname.startsWith('/api/syncs/')) return jobFor(hits);
    return [404, { success: false, error: 'not found' }];
  };

  const succeedsOnThirdPoll = (hits) => {
    const done = hits >= 3;
    return [200, { success: true, data: { job: { ...BASE_JOB, status: done ? 'success' : 'running' }, progress: progressFor(done) } }];
  };

  test('copy --wait exits 0 when the sync succeeds', async () => {
    await withServer(routes(succeedsOnThirdPoll), async (url) => {
      const r = await run(['copy', 'nginx:1.27', '--wait', '--interval', '1'], authed(url));
      assert.equal(r.code, EXIT.OK);
      assert.match(r.stdout, /Sync complete/);
    });
  });

  test('a failed sync exits 3 and surfaces the log URL', async () => {
    await withServer(routes(() => [200, { success: true, data: { job: { ...BASE_JOB, status: 'failed', conclusion: 'failure' }, progress: null } }]), async (url) => {
      const r = await run(['copy', 'nginx:1.27', '--wait', '--interval', '1'], authed(url));
      assert.equal(r.code, EXIT.JOB_FAILED);
      assert.match(r.stderr, /actions\/runs\/42/);
    });
  });

  test('a sync that never finishes exits 4', { timeout: 40_000 }, async () => {
    await withServer(routes(() => [200, { success: true, data: { job: { ...BASE_JOB, status: 'running' }, progress: progressFor(false) } }]), async (url) => {
      const r = await run(['status', 'job-1', '--wait', '--interval', '1', '--timeout', '10'], authed(url));
      assert.equal(r.code, EXIT.TIMEOUT);
      assert.match(r.stderr, /Timed out/);
    });
  });

  // Regression: waitForJob had no error handling, so one bad poll aborted the
  // whole wait even though the sync was still running.
  test('a transient poll failure does not abort the wait', async () => {
    let polls = 0;
    const flaky = ({ url, method, hits }) => {
      if (url.pathname === '/api/syncs' && method === 'POST') {
        return [201, { success: true, data: { job: { ...BASE_JOB, status: 'running' } } }];
      }
      if (url.pathname.startsWith('/api/syncs/')) {
        polls++;
        if (polls <= 2) return [500, { success: false, error: 'transient' }];
        return [200, { success: true, data: { job: { ...BASE_JOB, status: 'success' }, progress: progressFor(true) } }];
      }
      return [404, { success: false, error: 'nf' }];
    };

    await withServer(flaky, async (url) => {
      const r = await run(['copy', 'nginx:1.27', '--wait', '--interval', '1'], authed(url));
      assert.equal(r.code, EXIT.OK, 'two transient 500s must not fail the wait');
      assert.match(r.stderr, /retrying/);
    });
  });

  test('sustained poll failures eventually give up and name the job', async () => {
    const alwaysDown = ({ url, method }) => {
      if (url.pathname === '/api/syncs' && method === 'POST') {
        return [201, { success: true, data: { job: { ...BASE_JOB, status: 'running' } } }];
      }
      return [500, { success: false, error: 'down' }];
    };

    await withServer(alwaysDown, async (url) => {
      const r = await run(['copy', 'nginx:1.27', '--wait', '--interval', '1'], authed(url));
      assert.equal(r.code, EXIT.ERROR);
      assert.match(r.stderr, /Lost contact/);
      assert.match(r.stderr, /sdi status job-1/);
    });
  });

  test('list renders the job table', async () => {
    await withServer(routes(succeedsOnThirdPoll), async (url) => {
      const r = await run(['list'], authed(url));
      assert.equal(r.code, EXIT.OK);
      assert.match(r.stdout, /nginx:1\.27/);
    });
  });

  test('rm refuses to delete without confirmation on a non-TTY', async () => {
    await withServer(routes(succeedsOnThirdPoll), async (url) => {
      const r = await run(['rm', 'job-1'], authed(url));
      assert.equal(r.code, EXIT.USAGE);
      assert.match(r.stderr, /-y/);
    });
  });

  test('rm -y deletes', async () => {
    await withServer(routes(succeedsOnThirdPoll), async (url) => {
      const r = await run(['rm', 'job-1', '-y'], authed(url));
      assert.equal(r.code, EXIT.OK);
    });
  });
});

describe('--json contract', () => {
  const routes = ({ url, method, hits }) => {
    if (url.pathname === '/api/syncs' && method === 'POST') {
      return [201, { success: true, data: { job: { ...BASE_JOB, status: 'running' } } }];
    }
    if (url.pathname.startsWith('/api/syncs/')) {
      return [200, { success: true, data: { job: { ...BASE_JOB, status: 'success' }, progress: progressFor(true) } }];
    }
    if (url.pathname === '/api/syncs') {
      return [200, { success: true, data: { jobs: [{ ...BASE_JOB, status: 'success' }], total: 1 } }];
    }
    return [404, { success: false, error: 'nf' }];
  };

  test('stdout carries only JSON, so it stays pipeable', async () => {
    await withServer(routes, async (url) => {
      const r = await run(['copy', 'nginx:1.27', '--wait', '--interval', '1', '--json'], authed(url));
      assert.equal(r.code, EXIT.OK);

      const parsed = JSON.parse(r.stdout); // throws if any human output leaked
      assert.equal(parsed.job.status, 'success');
      assert.equal(parsed.destination, 'registry.example.com/team/nginx:1.27');
    });
  });

  test('list --json emits the raw payload', async () => {
    await withServer(routes, async (url) => {
      const r = await run(['list', '--json'], authed(url));
      assert.equal(r.code, EXIT.OK);
      assert.equal(JSON.parse(r.stdout).total, 1);
    });
  });

  test('errors stay off stdout in --json mode', async () => {
    await withServer(() => [200, {}], async (url) => {
      const r = await run(['whoami', '--json'], authed(url));
      assert.equal(r.code, EXIT.ERROR);
      assert.equal(r.stdout.trim(), '', 'stdout must stay empty so callers can parse it unconditionally');
    });
  });
});

describe('request construction', () => {
  // Regression: ids were interpolated into the path unencoded, so a traversal
  // sequence silently retargeted the request.
  test('job ids are percent-encoded into the path', async () => {
    let seenPath = null;

    await withServer(({ url }) => {
      seenPath = url.pathname;
      return [200, { success: true, data: { job: { ...BASE_JOB, status: 'success' }, progress: null } }];
    }, async (url) => {
      await run(['status', '../auth/me'], authed(url));
      assert.equal(seenPath, '/api/syncs/..%2Fauth%2Fme');
      assert.doesNotMatch(seenPath ?? '', /\/api\/auth\/me/);
    });
  });
});
