import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { authenticateMcp, mcpAuthResponse } from '../mcp-auth.js';

const migration = readFileSync(new URL('../migrations/0008_add_mcp.sql', import.meta.url), 'utf8');

function database(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) await statement.run();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

test('agent bearer tokens are hashed, scoped, and revoked', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  sqlite.exec(migration);
  const env = { DB: database(sqlite), PASSWORD: 'test-password' };
  const origin = 'https://notes.test';
  const request = (path, method = 'GET', body, headers = {}) => mcpAuthResponse(new Request(origin + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, { authenticated: true });
  try {
    const tooLong = await request('/api/agent-connections', 'POST', { name: 'Too long', scopes: ['notes:read'], grant: 'whole_notebook', consent: true, expires_in: 91 * 86400 }, { Origin: origin });
    assert.equal(tooLong.status, 400);
    const created = await request('/api/agent-connections', 'POST', {
      name: 'Reader',
      scopes: ['notes:read', 'notes:create'],
      grant: 'whole_notebook',
      consent: true,
    }, { Origin: origin });
    assert.equal(created.status, 201);
    const value = await created.json();
    assert.equal(value.scopes[1], 'notes:create');
    assert.ok(value.token);
    const stored = sqlite.prepare('SELECT token_hash FROM mcp_agent_connections').get();
    assert.notEqual(stored.token_hash, value.token);
    assert.equal((await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `Bearer ${value.token}` } }), env)).name, 'Reader');
    assert.deepEqual((await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `Bearer ${value.token}` } }), env)).scopes, ['notes:read', 'notes:create']);
    assert.ok(sqlite.prepare('SELECT last_used_at FROM mcp_agent_connections WHERE id = ?').get(value.id).last_used_at);
    const listed = await (await request('/api/agent-connections')).json();
    assert.ok(Array.isArray(listed));
    assert.equal((await request(`/api/agent-connections/${value.id}`, 'DELETE', undefined, { Origin: origin })).status, 200);
    assert.equal(await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `Bearer ${value.token}` } }), env), null);
    assert.equal((await request('/api/agent-connections', 'POST', { name: 'No origin', scopes: ['notes:read'], grant: 'whole_notebook', consent: true })).status, 403);
    assert.equal((await request('/api/agent-connections', 'POST', { name: 'No consent', scopes: ['notes:read'], grant: 'whole_notebook' }, { Origin: origin })).status, 400);
  } finally {
    sqlite.close();
  }
});

test('OAuth grants enforce CSRF, PKCE, metadata, rotation, expiry, and revocation', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  const env = { DB: database(sqlite), PASSWORD: 'test-password' };
  const origin = 'https://notes.test';
  const register = await mcpAuthResponse(new Request(origin + '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Remote client', redirect_uris: ['https://client.test/callback'] }),
  }), env);
  assert.equal(register.status, 201);
  const client = await register.json();
  const badRegister = await mcpAuthResponse(new Request(origin + '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['http://evil.test/callback'] }),
  }), env);
  assert.equal(badRegister.status, 400);
  const badAuthMethod = await mcpAuthResponse(new Request(origin + '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://client.test/callback'], token_endpoint_auth_method: 'client_secret_basic' }),
  }), env);
  assert.equal(badAuthMethod.status, 400);
  const metadata = await mcpAuthResponse(new Request(origin + '/.well-known/oauth-authorization-server'), env);
  assert.equal((await metadata.json()).authorization_response_iss_parameter_supported, true);
  const resourceMetadata = await mcpAuthResponse(new Request(origin + '/.well-known/oauth-protected-resource/mcp'), env);
  assert.equal((await resourceMetadata.json()).resource, origin + '/mcp');

  const verifier = 'verifier_' + 'x'.repeat(35);
  const challenge = await pkce(verifier);
  const makeQuery = (state) => new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://client.test/callback', scope: 'notes:read', resource: origin + '/mcp', code_challenge: challenge, code_challenge_method: 'S256', state });
  const getConsent = async (state) => {
    const query = makeQuery(state);
    const response = await mcpAuthResponse(new Request(`${origin}/oauth/authorize?${query}`), env, { authenticated: true });
    assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    const csrf = /name="csrf" value="([^"]+)"/.exec(await response.text())[1];
    return { query, cookie, csrf };
  };
  try {
    const unauthenticated = await mcpAuthResponse(new Request(`${origin}/oauth/authorize?${makeQuery('unauth')}`), env);
    assert.equal(unauthenticated.status, 401);

    const badRedirect = new URL(`${origin}/oauth/authorize?${makeQuery('bad-redirect')}`);
    badRedirect.searchParams.set('redirect_uri', 'https://other.test/callback');
    const invalid = await mcpAuthResponse(new Request(badRedirect), env, { authenticated: true });
    assert.equal(invalid.status, 400);

    const denied = await getConsent('denied');
    const deniedForm = new URLSearchParams(denied.query);
    deniedForm.set('csrf', denied.csrf);
    deniedForm.set('decision', 'deny');
    deniedForm.set('consent', '');
    const noGrant = await mcpAuthResponse(new Request(origin + '/oauth/authorize', { method: 'POST', headers: { Origin: origin, Cookie: denied.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: deniedForm }), env, { authenticated: true });
    assert.equal(noGrant.status, 303);
    assert.match(noGrant.headers.get('Location'), /access_denied/);
    assert.match(noGrant.headers.get('Location'), /iss=/);

    const consent = await getConsent('state-1');
    const form = new URLSearchParams(consent.query);
    form.set('csrf', consent.csrf);
    form.set('decision', 'approve');
    form.set('consent', 'yes');
    const tampered = new URLSearchParams(form);
    tampered.set('scope', 'notes:edit');
    assert.equal((await mcpAuthResponse(new Request(origin + '/oauth/authorize', { method: 'POST', headers: { Origin: origin, Cookie: consent.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: tampered }), env, { authenticated: true })).status, 403);
    const approved = await mcpAuthResponse(new Request(origin + '/oauth/authorize', { method: 'POST', headers: { Origin: origin, Cookie: consent.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), env, { authenticated: true });
    assert.equal(approved.status, 303);
    const callback = new URL(approved.headers.get('Location'));
    const code = callback.searchParams.get('code');
    assert.ok(code);
    assert.equal(callback.searchParams.get('iss'), origin);
    const replay = await mcpAuthResponse(new Request(origin + '/oauth/authorize', { method: 'POST', headers: { Origin: origin, Cookie: consent.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), env, { authenticated: true });
    assert.equal(replay.status, 403);
    const noOrigin = await mcpAuthResponse(new Request(origin + '/oauth/authorize', { method: 'POST', headers: { Cookie: consent.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), env, { authenticated: true });
    assert.equal(noOrigin.status, 403);

    const badResourceBody = new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: 'https://client.test/callback', resource: origin + '/wrong', code_verifier: verifier });
    const badResource = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: badResourceBody }), env);
    assert.equal(badResource.status, 400);
    const badVerifierBody = new URLSearchParams({ ...Object.fromEntries(badResourceBody), resource: origin + '/mcp', code_verifier: 'wrong_' + 'x'.repeat(38) });
    const badVerifier = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: badVerifierBody }), env);
    assert.equal(badVerifier.status, 400);

    const second = await getConsent('state-2');
    const secondForm = new URLSearchParams(second.query);
    secondForm.set('csrf', second.csrf);
    secondForm.set('decision', 'approve');
    secondForm.set('consent', 'yes');
    const secondApproved = await mcpAuthResponse(new Request(origin + '/oauth/authorize', { method: 'POST', headers: { Origin: origin, Cookie: second.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: secondForm }), env, { authenticated: true });
    const secondCode = new URL(secondApproved.headers.get('Location')).searchParams.get('code');
    const tokenBody = new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code: secondCode, redirect_uri: 'https://client.test/callback', resource: origin + '/mcp', code_verifier: verifier });
    const tokens = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody }), env);
    assert.equal(tokens.status, 200);
    const tokenValue = await tokens.json();
    const principal = await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `bEaReR ${tokenValue.access_token}` } }), env);
    assert.deepEqual(principal.scopes, ['notes:read']);
    const reused = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody }), env);
    assert.equal(reused.status, 400);

    const refreshBody = new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokenValue.refresh_token, resource: origin + '/mcp' });
    const refreshed = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: refreshBody }), env);
    assert.equal(refreshed.status, 200);
    const refreshedValue = await refreshed.json();
    assert.notEqual(refreshedValue.refresh_token, tokenValue.refresh_token);
    const refreshReuse = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: refreshBody }), env);
    assert.equal(refreshReuse.status, 400);
    assert.equal(await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `Bearer ${refreshedValue.access_token}` } }), env), null);
    const grant = { id: principal.id };
    // Reset the fixture to exercise expiry and explicit revocation independently.
    sqlite.prepare('UPDATE mcp_agent_connections SET revoked_at = NULL WHERE id = ?').run(grant.id);
    sqlite.prepare('UPDATE mcp_agent_connections SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', grant.id);
    assert.equal(await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `Bearer ${refreshedValue.access_token}` } }), env), null);
    const expiredRefresh = new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: refreshedValue.refresh_token, resource: origin + '/mcp' });
    assert.equal((await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: expiredRefresh }), env)).status, 400);
    sqlite.prepare('UPDATE mcp_agent_connections SET expires_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', grant.id);
    const revoked = await mcpAuthResponse(new Request(`${origin}/api/agent-connections/${grant.id}`, { method: 'DELETE', headers: { Origin: origin } }), env, { authenticated: true });
    assert.equal(revoked.status, 200);
    assert.equal(await authenticateMcp(new Request(origin + '/mcp', { headers: { Authorization: `Bearer ${refreshedValue.access_token}` } }), env), null);
    const revokedRefresh = await mcpAuthResponse(new Request(origin + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: expiredRefresh }), env);
    assert.equal(revokedRefresh.status, 400);
  } finally {
    sqlite.close();
  }
});
