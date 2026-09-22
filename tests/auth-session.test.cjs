const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  mod._compile(result.outputText, filename);
};

const root = path.resolve(__dirname, '..');
const realFetch = global.fetch;
const realError = console.error;
const initialSecret = process.env.SUPABASE_SECRET_KEY;
const accessKey = 'basement_access_token';
const refreshKey = 'basement_refresh_token';
const jwt = (seconds, id = 'owner') => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds, sub: id })).toString('base64url')}.signature`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = () => require('../lib/session.ts');
const route = () => require('../app/api/admin/create-member/route.ts');
const request = () => new Request('https://club.example/api/admin/create-member', { method: 'POST', headers: { Authorization: `Bearer ${jwt(3600)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Test Member', email: 'test@example.invalid', password: 'example-only-password' }) });

beforeEach(() => {
  for (const filename of Object.keys(require.cache)) if (filename.startsWith(root) && filename.endsWith('.ts')) delete require.cache[filename];
  const values = new Map();
  global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  global.window = {};
  console.error = () => {};
  process.env.SUPABASE_SECRET_KEY = 'test-server-key';
});
afterEach(() => {
  global.fetch = realFetch;
  console.error = realError;
  delete global.localStorage;
  delete global.window;
  if (initialSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = initialSecret;
});

test('fresh access token needs no refresh request', async () => {
  const token = jwt(3600);
  session().saveSession({ access_token: token, refresh_token: 'refresh' });
  global.fetch = () => { throw new Error('unexpected network request'); };
  assert.equal(await session().accessToken(), token);
});

test('parallel expired requests share one refresh and rotate both tokens', async () => {
  session().saveSession({ access_token: jwt(-1), refresh_token: 'old-refresh' });
  const next = jwt(3600);
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.match(url, /grant_type=refresh_token$/);
    assert.equal(JSON.parse(init.body).refresh_token, 'old-refresh');
    await new Promise(resolve => setImmediate(resolve));
    return json({ access_token: next, refresh_token: 'new-refresh' });
  };
  const result = await Promise.all([session().accessToken(), session().accessToken(), session().accessToken()]);
  assert.deepEqual(result, [next, next, next]);
  assert.equal(calls, 1);
  assert.equal(localStorage.getItem(refreshKey), 'new-refresh');
});

test('a Supabase outage preserves the stored session', async () => {
  const old = jwt(-1);
  session().saveSession({ access_token: old, refresh_token: 'refresh' });
  global.fetch = async () => json({ error_code: 'unexpected_failure' }, 503);
  await assert.rejects(session().accessToken(), /HTTP 503/);
  assert.equal(localStorage.getItem(accessKey), old);
  assert.equal(localStorage.getItem(refreshKey), 'refresh');
});

test('a revoked refresh token clears only that session', async () => {
  session().saveSession({ access_token: jwt(-1), refresh_token: 'revoked' });
  global.fetch = async () => json({ error_code: 'refresh_token_not_found' }, 400);
  await assert.rejects(session().accessToken(), session().SessionExpiredError);
  assert.equal(localStorage.getItem(accessKey), null);
  assert.equal(localStorage.getItem(refreshKey), null);
});

test('a pending refresh cannot restore a session after logout', async () => {
  session().saveSession({ access_token: jwt(-1), refresh_token: 'refresh' });
  let complete;
  global.fetch = () => new Promise(resolve => { complete = resolve; });
  const pending = session().accessToken();
  await new Promise(resolve => setImmediate(resolve));
  session().clearSession();
  complete(json({ access_token: jwt(3600), refresh_token: 'new-refresh' }));
  await assert.rejects(pending, /Η σύνδεση άλλαξε/);
  assert.equal(localStorage.getItem(accessKey), null);
});

test('member creation retries once only after an explicit pre-creation auth rejection', async () => {
  const old = jwt(3500);
  const fresh = jwt(3600);
  session().saveSession({ access_token: old, refresh_token: 'refresh' });
  let creates = 0, refreshes = 0;
  global.fetch = async (url, init) => {
    if (url.includes('grant_type=refresh_token')) { refreshes++; return json({ access_token: fresh, refresh_token: 'rotated' }); }
    creates++;
    if (creates === 1) return json({ code: 'SESSION_EXPIRED' }, 401);
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${fresh}`);
    return json({ id: 'member' });
  };
  const result = await session().memberRequest({ method: 'POST', body: '{}' });
  assert.equal(result.status, 200);
  assert.equal(creates, 2);
  assert.equal(refreshes, 1);
});

test('uncertain member creation failure is never automatically repeated', async () => {
  session().saveSession({ access_token: jwt(3600), refresh_token: 'refresh' });
  let count = 0;
  global.fetch = async () => { count++; return json({ code: 'UPSTREAM_UNAVAILABLE' }, 502); };
  assert.equal((await session().memberRequest({ method: 'POST', body: '{}' })).status, 502);
  assert.equal(count, 1);
});

test('calendar requests use a refreshed token before accessing Supabase', async () => {
  const old = jwt(-1), fresh = jwt(3600);
  session().saveSession({ access_token: old, refresh_token: 'refresh' });
  global.fetch = async (url, init) => {
    if (url.includes('grant_type=refresh_token')) return json({ access_token: fresh, refresh_token: 'rotated' });
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${fresh}`);
    return json([]);
  };
  assert.equal((await require('../lib/supabase-rest.ts').api('/rest/v1/rpc/basement_availability', old)).status, 200);
});

test('a missing user session never reaches the privileged API', async () => {
  global.fetch = () => { throw new Error('unexpected request'); };
  const result = await route().POST(new Request('https://club.example/api', { method: 'POST' }));
  assert.equal(result.status, 401);
  assert.equal((await result.json()).code, 'SESSION_EXPIRED');
});

test('an expired user JWT is identified before any member mutation', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return json({ error_code: 'bad_jwt' }, 401); };
  const result = await route().POST(request());
  assert.equal(result.status, 401);
  assert.equal((await result.json()).code, 'SESSION_EXPIRED');
  assert.equal(calls, 1);
});

test('upstream outage is not falsely reported as an expired session', async () => {
  global.fetch = async () => json({ error_code: 'unexpected_failure' }, 503);
  const result = await route().POST(request());
  assert.equal(result.status, 502);
  const data = await result.json();
  assert.equal(data.code, 'AUTH_CHECK_FAILED');
  assert.match(data.error, /503\/unexpected_failure/);
});

test('ordinary members cannot reach user creation even with a valid session', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? json({ id: 'member' }) : json([{ role: 'customer' }]); };
  const result = await route().POST(request());
  assert.equal(result.status, 403);
  assert.equal(calls, 2);
});

test('invalid server key does not cause a session refresh loop', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? json({ id: 'owner' }) : calls === 2 ? json([{ role: 'owner' }]) : json({ message: 'Invalid API key' }, 401); };
  const result = await route().POST(request());
  assert.equal(result.status, 502);
  assert.equal((await result.json()).code, 'SERVER_KEY_REJECTED');
  assert.equal(calls, 3);
});

function successfulOwnerBeforeProfile(profileResponse) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return json({ id: 'owner' });
    if (calls.length === 2) return json([{ role: 'owner' }]);
    if (calls.length === 3) return json({ id: 'new-customer' });
    assert.equal(calls.length, 4, 'no repeated account creation');
    assert.equal(init.method, 'PATCH');
    assert.equal(JSON.parse(init.body).role, 'customer');
    assert.equal(new Headers(init.headers).get('Prefer'), 'return=representation');
    return typeof profileResponse === 'function' ? profileResponse() : profileResponse;
  };
  return calls;
}

test('member creation uses the supported customer role and returns the saved profile', async () => {
  const calls = successfulOwnerBeforeProfile(json([{ id: 'new-customer', full_name: 'Test Member', role: 'customer' }]));
  const result = await route().POST(request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { id: 'new-customer', full_name: 'Test Member', role: 'customer' });
  assert.equal(calls.length, 4);
});

for (const [name, response] of [
  ['profile update rejects the role', () => json({ code: '22P02' }, 400)],
  ['profile trigger created no matching row', () => json([])],
  ['profile has an unexpected role', () => json([{ id: 'new-customer', full_name: 'Test Member', role: 'owner' }])],
  ['profile save loses its network response', () => { throw new TypeError('fetch failed'); }],
]) {
  test(`${name}: no false success and no automatic account retry`, async () => {
    const calls = successfulOwnerBeforeProfile(response);
    const result = await route().POST(request());
    assert.equal(result.status, 502);
    const data = await result.json();
    assert.equal(data.code, 'MEMBER_PROFILE_FAILED');
    assert.equal(data.account_created, true);
    assert.equal(calls.length, 4);
  });
}
