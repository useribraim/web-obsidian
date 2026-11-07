const PERMISSIONS = ['notes:read', 'notes:create', 'notes:append', 'notes:edit'];
const PERMISSION_SET = new Set(PERMISSIONS);
const SCOPE_DESCRIPTIONS = {
  'notes:read': 'Read notes across the whole notebook',
  'notes:create': 'Create notes in the whole notebook',
  'notes:append': 'Append to notes in the whole notebook',
  'notes:edit': 'Edit notes across the whole notebook',
};
const CSRF_COOKIE = 'mcp_oauth_csrf';
const CONNECTION_PATH = '/api/agent-connections';
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 32 * 1024;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_CONNECTION_TTL_SECONDS = 90 * 24 * 60 * 60;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 60;
const registrations = new Map();
const usedCsrf = new Map();

const nowSeconds = () => Math.floor(Date.now() / 1000);
const isoIn = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const json = (body, status = 200, extra = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', ...extra },
});

function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function cookieValue(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

function authorizationFields(fields) {
  return new URLSearchParams(['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'resource', 'code_challenge', 'code_challenge_method']
    .map((name) => [name, fields.get(name) || ''])).toString();
}

function strictSameOrigin(request, url) {
  return request.headers.get('Origin') === url.origin;
}

function principalScopes(value) {
  try {
    const scopes = JSON.parse(value);
    return Array.isArray(scopes) && scopes.every((scope) => PERMISSION_SET.has(scope)) ? scopes : [];
  } catch {
    return [];
  }
}

async function readBody(request, limit = MAX_BODY_BYTES) {
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function bodyJSON(request, limit = MAX_BODY_BYTES) {
  const text = await readBody(request, limit);
  if (text === null) return { error: json({ error: 'Request body is too large.' }, 413) };
  try {
    const value = JSON.parse(text);
    return { value };
  } catch {
    return { error: json({ error: 'Invalid JSON request.' }, 400) };
  }
}

async function bodyForm(request, limit = MAX_BODY_BYTES) {
  const text = await readBody(request, limit);
  if (text === null) return { error: json({ error: 'Request body is too large.' }, 413) };
  return { value: new URLSearchParams(text) };
}

function scopes(value, { defaultRead = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') return defaultRead ? ['notes:read'] : null;
  const result = value.trim().split(/\s+/);
  if (result.length > PERMISSIONS.length || new Set(result).size !== result.length || result.some((scope) => !PERMISSION_SET.has(scope))) return null;
  return result;
}

function resourceFor(url) {
  return new URL(MCP_PATH, url.origin).toString();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function oauthJSON(body, status = 200, extra = {}) {
  return json(body, status, { ...corsHeaders(), ...extra });
}

function oauthError(error, description, status = 400, headers = {}) {
  return oauthJSON({ error, ...(description ? { error_description: description } : {}) }, status, headers);
}

function oauthRedirect(redirectUri, values) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, value);
  }
  return new Response(null, { status: 303, headers: { Location: target.toString(), 'Cache-Control': 'no-store' } });
}

function validRedirectUri(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || !url.hostname) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function parseScopesJSON(value) {
  const result = principalScopes(value);
  if (result.length) return result;
  return scopes(value);
}

async function activeGrant(env, id, now) {
  return env.DB.prepare(
    "SELECT id, name, scopes FROM mcp_agent_connections WHERE id = ? AND kind = 'oauth' AND revoked_at IS NULL AND expires_at > ?"
  ).bind(id, now).first();
}

function boundedScopes(value, grantValue) {
  const tokenScopes = parseScopesJSON(value);
  const grantScopes = parseScopesJSON(grantValue);
  return tokenScopes && grantScopes && tokenScopes.every((scope) => grantScopes.includes(scope)) ? tokenScopes : null;
}

async function authenticateMcp(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== MCP_PATH) return null;
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]{20,512})$/i);
  if (!match || !env.DB) return null;
  const tokenHash = await digest(match[1]);
  const now = new Date().toISOString();
  const connection = await env.DB.prepare(
    "SELECT id, name, scopes FROM mcp_agent_connections WHERE kind = 'pat' AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
  ).bind(tokenHash, now).first();
  if (connection) {
    const scopes = parseScopesJSON(connection.scopes);
    if (!scopes) return null;
    await env.DB.prepare("UPDATE mcp_agent_connections SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revoked_at IS NULL").bind(connection.id).run();
    return { id: connection.id, name: connection.name, scopes };
  }
  const token = await env.DB.prepare(
    "SELECT t.principal_id, t.principal_name, t.scope, c.scopes AS grant_scopes FROM mcp_oauth_tokens t JOIN mcp_agent_connections c ON c.id = t.principal_id WHERE t.token_hash = ? AND t.token_type = 'access' AND t.resource = ? AND t.expires_at > ? AND c.kind = 'oauth' AND c.revoked_at IS NULL AND c.expires_at > ?"
  ).bind(tokenHash, resourceFor(url), now, now).first();
  if (!token) return null;
  const scopes = boundedScopes(token.scope, token.grant_scopes);
  if (!scopes) return null;
  await env.DB.prepare("UPDATE mcp_agent_connections SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revoked_at IS NULL").bind(token.principal_id).run();
  return { id: token.principal_id, name: token.principal_name, scopes };
}

function unauthorized(url) {
  return json({ error: 'Bearer token required.' }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', url.origin).toString()}"`,
  });
}

async function connectionResponse(request, env, url, authenticated) {
  if (url.pathname !== CONNECTION_PATH && !url.pathname.startsWith(`${CONNECTION_PATH}/`)) return null;
  if (!authenticated) return json({ error: 'Sign in required.' }, 401);
  if (url.pathname === CONNECTION_PATH && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, name, kind, scopes, expires_at, created_at, revoked_at, last_used_at FROM mcp_agent_connections ORDER BY created_at DESC'
    ).all();
    return json(results.map((row) => ({ ...row, scopes: parseScopesJSON(row.scopes) || [] })));
  }
  if (url.pathname === CONNECTION_PATH && request.method === 'POST') {
    if (!strictSameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
    const parsed = await bodyJSON(request);
    if (parsed.error) return parsed.error;
    const data = parsed.value;
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const requestedScopes = Array.isArray(data?.scopes) ? data.scopes : null;
    const grant = data?.grant === 'whole_notebook';
    const consent = data?.consent === true;
    if (!name || name.length > 100 || !requestedScopes || !consent || !grant || requestedScopes.length === 0 || requestedScopes.length > PERMISSIONS.length || new Set(requestedScopes).size !== requestedScopes.length || requestedScopes.some((scope) => !PERMISSION_SET.has(scope))) {
      return json({ error: 'Name, explicit whole-notebook consent, and valid scopes are required.' }, 400);
    }
    const expiresIn = data.expires_in === undefined ? TOKEN_TTL_SECONDS : data.expires_in;
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > MAX_CONNECTION_TTL_SECONDS) return json({ error: 'Expiry must be between 60 seconds and 90 days.' }, 400);
    const expiresAt = isoIn(expiresIn);
    const token = randomToken();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO mcp_agent_connections (id, name, kind, token_hash, scopes, expires_at) VALUES (?, ?, 'pat', ?, ?, ?)"
    ).bind(id, name, await digest(token), JSON.stringify(requestedScopes), expiresAt).run();
    return json({ id, name, scopes: requestedScopes, expires_at: expiresAt, token }, 201);
  }
  const match = url.pathname.match(/^\/api\/agent-connections\/([^/]+)$/);
  if (!match) return json({ error: 'Not found.' }, 404);
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed.' }, 405);
  if (!strictSameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return json({ error: 'Connection not found.' }, 404); }
  const result = await env.DB.prepare("UPDATE mcp_agent_connections SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revoked_at IS NULL").bind(id).run();
  return result.meta?.changes ? json({ ok: true }) : json({ error: 'Connection not found.' }, 404);
}

async function csrfToken(request, env, fields) {
  const cookie = cookieValue(request, CSRF_COOKIE);
  const supplied = fields.get('csrf') || '';
  const cookieParts = cookie.split('.');
  const tokenParts = supplied.split('.');
  if (cookieParts.length !== 2 || tokenParts.length !== 3 || cookieParts[0] !== tokenParts[0] || cookieParts[1] !== tokenParts[1]) return false;
  const expires = Number(cookieParts[1]);
  if (!Number.isInteger(expires) || expires < nowSeconds()) return false;
  const sessionCookie = cookieValue(request, 'obsidian_session');
  const payload = `${authorizationFields(fields)}|session=${sessionCookie}|nonce=${cookieParts[0]}|expires=${expires}`;
  const expected = await hmac(payload, String(env.MCP_CSRF_SECRET || env.PASSWORD || ''));
  try {
    if (!equalBytes(fromBase64Url(tokenParts[2]), fromBase64Url(expected))) return false;
  } catch {
    return false;
  }
  const key = `${sessionCookie}|${cookie}`;
  const current = Date.now();
  for (const [used, at] of usedCsrf) if (at < current - 10 * 60 * 1000) usedCsrf.delete(used);
  if (usedCsrf.has(key)) return false;
  if (usedCsrf.size >= 2048) usedCsrf.delete(usedCsrf.keys().next().value);
  usedCsrf.set(key, current);
  return true;
}

async function authorizeRequest(url, env) {
  const params = url.searchParams;
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';
  if (!clientId || clientId.length > 200) return { response: oauthError('invalid_request', 'Missing client_id.') };
  const client = await env.DB.prepare('SELECT client_id, client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = ?').bind(clientId).first();
  if (!client) return { response: oauthError('unauthorized_client', 'Unknown client.') };
  let redirects;
  try { redirects = JSON.parse(client.redirect_uris); } catch { redirects = []; }
  if (!Array.isArray(redirects) || !redirects.includes(redirectUri)) return { response: oauthError('invalid_request', 'The redirect_uri is not registered.') };
  const safeState = state.length <= 2048 ? state : '';
  const fail = (error, description) => ({ client, redirectUri, state: safeState, response: oauthRedirect(redirectUri, { error, error_description: description, state: safeState, iss: url.origin }) });
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (!params.get('code_challenge') || params.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'A PKCE S256 code_challenge is required.');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(params.get('code_challenge'))) return fail('invalid_request', 'Invalid code_challenge.');
  if (params.get('resource') !== resourceFor(url)) return fail('invalid_target', 'The resource must be the MCP endpoint.');
  const requestedScopes = scopes(params.get('scope'), { defaultRead: true });
  if (!requestedScopes) return fail('invalid_scope', 'One or more requested scopes are not supported.');
  return { client, redirectUri, state: safeState, requestedScopes, codeChallenge: params.get('code_challenge') };
}

async function consentResponse(request, env, url, authenticated) {
  if (url.pathname !== '/oauth/authorize') return null;
  if (request.method === 'GET') {
    const auth = await authorizeRequest(url, env);
    if (auth.response) return auth.response;
    if (!authenticated) return json({ error: 'Sign in required.' }, 401);
    const nonce = randomToken(24);
    const csrfExpires = nowSeconds() + 10 * 60;
    const fields = new URLSearchParams(url.search);
    const csrfPayload = `${authorizationFields(fields)}|session=${cookieValue(request, 'obsidian_session')}|nonce=${nonce}|expires=${csrfExpires}`;
    const csrf = `${nonce}.${csrfExpires}.${await hmac(csrfPayload, String(env.MCP_CSRF_SECRET || env.PASSWORD || ''))}`;
    const scopeList = auth.requestedScopes.map((scope) => `<li>${htmlEscape(SCOPE_DESCRIPTIONS[scope])}</li>`).join('');
    const hidden = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'resource', 'code_challenge', 'code_challenge_method']
      .map((name) => `<input type="hidden" name="${name}" value="${htmlEscape(fields.get(name) || '')}">`).join('');
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="same-origin">
  <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/agents.css">
  <title>Authorize MCP client</title>
</head>
<body class="agents-page"><main class="agent-settings"><section class="agent-panel">
  <h1>Authorize ${htmlEscape(auth.client.client_name || auth.client.client_id)}</h1>
  <p>This client is asking for access to your <strong>whole notebook</strong>.</p>
  <ul>${scopeList}</ul>
  <p>Client names are self-reported. Only approve an application you trust. This connection expires in 30 days.</p>
  <form method="post" action="/oauth/authorize">
    ${hidden}<input type="hidden" name="csrf" value="${htmlEscape(csrf)}">
    <label class="agent-consent"><input type="checkbox" name="consent" value="yes" required> I approve this whole-notebook access</label>
    <p><button class="tool" name="decision" value="approve" type="submit">Allow</button> <button class="tool" name="decision" value="deny" type="submit" formnovalidate>Deny</button></p>
  </form>
</section></main></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Set-Cookie': `${CSRF_COOKIE}=${nonce}.${csrfExpires}; Max-Age=600; Path=/oauth; HttpOnly; Secure; SameSite=Strict` } });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!authenticated) return json({ error: 'Sign in required.' }, 401);
  if (!strictSameOrigin(request, url)) return json({ error: 'Invalid origin.' }, 403);
  const parsed = await bodyForm(request, 16 * 1024);
  if (parsed.error) return parsed.error;
  const fields = parsed.value;
  if (!(await csrfToken(request, env, fields))) return json({ error: 'Invalid consent token.' }, 403);
  const requestUrl = new URL(request.url);
  requestUrl.search = new URLSearchParams(fields).toString();
  const auth = await authorizeRequest(requestUrl, env);
  if (auth.response) return auth.response;
  if (fields.get('decision') !== 'approve' || !['yes', 'on', 'true'].includes(fields.get('consent') || '')) return oauthRedirect(auth.redirectUri, { error: 'access_denied', error_description: 'The user denied access.', state: auth.state, iss: url.origin });
  const code = randomToken();
  const connectionId = crypto.randomUUID();
  const connectionName = auth.client.client_name || auth.client.client_id;
  const connectionExpiresAt = isoIn(TOKEN_TTL_SECONDS);
  const expiresAt = isoIn(CODE_TTL_SECONDS);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mcp_agent_connections (id, name, kind, token_hash, scopes, expires_at) VALUES (?, ?, 'oauth', NULL, ?, ?)").bind(connectionId, connectionName, JSON.stringify(auth.requestedScopes), connectionExpiresAt),
    env.DB.prepare(
      'INSERT INTO mcp_oauth_codes (id, code_hash, client_id, redirect_uri, scope, resource, code_challenge, code_challenge_method, principal_id, principal_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), await digest(code), auth.client.client_id, auth.redirectUri, auth.requestedScopes.join(' '), resourceFor(url), auth.codeChallenge, 'S256', connectionId, connectionName, expiresAt),
  ]);
  return oauthRedirect(auth.redirectUri, { code, state: auth.state, iss: url.origin });
}

function registrationAllowed(request) {
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  for (const [address, times] of registrations) {
    const recent = times.filter((time) => time > now - 60_000);
    if (recent.length) registrations.set(address, recent);
    else registrations.delete(address);
  }
  while (registrations.size >= 1000) registrations.delete(registrations.keys().next().value);
  const previous = registrations.get(key) || [];
  const recent = previous;
  if (recent.length >= 20) return false;
  recent.push(now);
  registrations.set(key, recent);
  return true;
}

async function registrationResponse(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, corsHeaders());
  if (!registrationAllowed(request)) return oauthError('temporarily_unavailable', 'Registration rate limit exceeded.', 429);
  const parsed = await bodyJSON(request);
  if (parsed.error) return parsed.error;
  const data = parsed.value;
  const redirects = data?.redirect_uris;
  const authMethod = data?.token_endpoint_auth_method === undefined ? 'none' : data.token_endpoint_auth_method;
  const grantTypes = data?.grant_types === undefined ? ['authorization_code', 'refresh_token'] : data.grant_types;
  const responseTypes = data?.response_types === undefined ? ['code'] : data.response_types;
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 10 || redirects.some((redirect) => !validRedirectUri(redirect)) || new Set(redirects).size !== redirects.length) return oauthError('invalid_client_metadata', 'redirect_uris must contain unique HTTPS or localhost HTTP URLs.');
  if (authMethod !== 'none' || !Array.isArray(grantTypes) || new Set(grantTypes).size !== grantTypes.length || grantTypes.some((grantType) => !['authorization_code', 'refresh_token'].includes(grantType)) || !grantTypes.includes('authorization_code') || !Array.isArray(responseTypes) || new Set(responseTypes).size !== responseTypes.length || responseTypes.some((responseType) => responseType !== 'code') || !responseTypes.includes('code')) return oauthError('invalid_client_metadata', 'Only public PKCE authorization-code clients are supported.');
  const name = typeof data.client_name === 'string' && data.client_name.trim() ? data.client_name.trim().slice(0, 100) : 'MCP client';
  const clientId = `client_${randomToken(18)}`;
  await env.DB.prepare('INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method) VALUES (?, ?, ?, ?)').bind(clientId, name, JSON.stringify(redirects), authMethod).run();
  return oauthJSON({ client_id: clientId, client_id_issued_at: nowSeconds(), client_name: name, redirect_uris: redirects, token_endpoint_auth_method: authMethod, grant_types: grantTypes, response_types: responseTypes }, 201);
}

async function tokenResponse(request, env, url) {
  if (request.method !== 'POST') return oauthError('invalid_request', 'POST is required.', 405, { Allow: 'POST' });
  const parsed = await bodyForm(request);
  if (parsed.error) return parsed.error;
  const fields = parsed.value;
  const grantType = fields.get('grant_type');
  const clientId = fields.get('client_id') || '';
  const resource = fields.get('resource') || '';
  if (resource !== resourceFor(url)) return oauthError('invalid_target', 'The resource must be the MCP endpoint.');
  if (!clientId) return oauthError('invalid_client', 'client_id is required.');
  const client = await env.DB.prepare('SELECT client_id, token_endpoint_auth_method FROM mcp_oauth_clients WHERE client_id = ?').bind(clientId).first();
  if (!client || client.token_endpoint_auth_method !== 'none') return oauthError('invalid_client', 'Unknown public client.');
  const now = new Date().toISOString();
  let principal;
  let scope;
  let familyId;
  if (grantType === 'authorization_code') {
    const code = fields.get('code') || '';
    const verifier = fields.get('code_verifier') || '';
    const redirectUri = fields.get('redirect_uri') || '';
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !redirectUri) return oauthError('invalid_grant', 'The authorization code, redirect_uri, and verifier are required.');
    const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const row = await env.DB.prepare(
      "DELETE FROM mcp_oauth_codes WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND resource = ? AND expires_at > ? AND EXISTS (SELECT 1 FROM mcp_agent_connections c WHERE c.id = mcp_oauth_codes.principal_id AND c.kind = 'oauth' AND c.revoked_at IS NULL AND c.expires_at > ?) RETURNING *"
    ).bind(await digest(code), clientId, redirectUri, resource, now, now).first();
    if (!row || !equalBytes(new TextEncoder().encode(challenge), new TextEncoder().encode(row.code_challenge))) return oauthError('invalid_grant', 'Invalid authorization code or PKCE verifier.');
    const grant = await activeGrant(env, row.principal_id, now);
    scope = grant && boundedScopes(row.scope, grant.scopes)?.join(' ');
    if (!grant || !scope) return oauthError('invalid_grant', 'The authorization grant is no longer active.');
    principal = { id: grant.id, name: grant.name };
    familyId = crypto.randomUUID();
  } else if (grantType === 'refresh_token') {
    const refresh = fields.get('refresh_token') || '';
    if (!refresh) return oauthError('invalid_grant', 'refresh_token is required.');
    const row = await env.DB.prepare(
      "UPDATE mcp_oauth_tokens SET used_at = ? WHERE token_hash = ? AND token_type = 'refresh' AND used_at IS NULL AND client_id = ? AND resource = ? AND expires_at > ? AND EXISTS (SELECT 1 FROM mcp_agent_connections c WHERE c.id = mcp_oauth_tokens.principal_id AND c.kind = 'oauth' AND c.revoked_at IS NULL AND c.expires_at > ?) RETURNING *"
    ).bind(now, await digest(refresh), clientId, resource, now, now).first();
    if (!row) {
      // A recognized rotated token being reused can mean it was stolen.
      const replay = await env.DB.prepare("SELECT principal_id FROM mcp_oauth_tokens WHERE token_hash = ? AND token_type = 'refresh' AND used_at IS NOT NULL AND client_id = ? AND resource = ?").bind(await digest(refresh), clientId, resource).first();
      if (replay) await env.DB.prepare('UPDATE mcp_agent_connections SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, replay.principal_id).run();
      return oauthError('invalid_grant', 'Invalid or already-used refresh token. Reconnect if access was revoked.');
    }
    const grant = await activeGrant(env, row.principal_id, now);
    scope = grant && boundedScopes(row.scope, grant.scopes)?.join(' ');
    if (!grant || !scope) return oauthError('invalid_grant', 'The authorization grant is no longer active.');
    principal = { id: grant.id, name: grant.name };
    familyId = row.family_id;
  } else {
    return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  }
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const accessExpires = isoIn(ACCESS_TTL_SECONDS);
  const refreshExpires = isoIn(REFRESH_TTL_SECONDS);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO mcp_oauth_tokens (id, token_hash, token_type, client_id, principal_id, principal_name, scope, resource, family_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), await digest(accessToken), 'access', clientId, principal.id, principal.name, scope, resource, familyId, accessExpires),
    env.DB.prepare('INSERT INTO mcp_oauth_tokens (id, token_hash, token_type, client_id, principal_id, principal_name, scope, resource, family_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), await digest(refreshToken), 'refresh', clientId, principal.id, principal.name, scope, resource, familyId, refreshExpires),
  ]);
  return oauthJSON({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refreshToken, scope });
}

function discoveryResponse(url, kind) {
  const issuer = url.origin;
  const resource = resourceFor(url);
  if (kind === 'resource') return json({ resource, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: PERMISSIONS }, 200, { ...corsHeaders(), 'WWW-Authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', issuer).toString()}"` });
  return json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true, scopes_supported: PERMISSIONS }, 200, corsHeaders());
}

async function mcpAuthResponse(request, env, { authenticated = false } = {}) {
  const url = new URL(request.url);
  const protectedResource = url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/mcp/.well-known/oauth-protected-resource';
  if (protectedResource && request.method === 'GET') return discoveryResponse(url, 'resource');
  if (url.pathname === '/.well-known/oauth-authorization-server' && request.method === 'GET') return discoveryResponse(url, 'authorization');
  if (url.pathname === '/oauth/register') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    return registrationResponse(request, env);
  }
  if (url.pathname === '/oauth/token') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    return tokenResponse(request, env, url);
  }
  const consent = await consentResponse(request, env, url, authenticated);
  if (consent) return consent;
  const connections = await connectionResponse(request, env, url, authenticated);
  if (connections) return connections;
  if (url.pathname === MCP_PATH) {
    return (await authenticateMcp(request, env)) ? null : unauthorized(url);
  }
  return null;
}

export { PERMISSIONS, authenticateMcp, mcpAuthResponse, readBody };
