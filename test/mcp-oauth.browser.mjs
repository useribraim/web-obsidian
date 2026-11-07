// Run against an isolated local Wrangler database, never the live notebook.
export default async function testOAuth(page, { origin, password }) {
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('OAuth browser tests require a local test notebook.');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.goto(origin + '/agents');
  if (await page.locator('#password').count()) {
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await page.locator('#agent-name').waitFor();
  const registration = await page.request.post(origin + '/oauth/register', {
    data: { client_name: 'OAuth browser test', redirect_uris: [origin + '/agents'], token_endpoint_auth_method: 'none' },
  });
  assert(registration.status() === 201, 'Client registration succeeds');
  const client = await registration.json();
  // RFC 7636 test vector, not a production credential.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const params = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: origin + '/agents',
    resource: origin + '/mcp', scope: 'notes:read notes:create', state: 'browser-test-state',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256',
  });
  const consent = await page.goto(origin + '/oauth/authorize?' + params);
  assert(consent.status() === 200, 'Consent page loads');
  assert(consent.headers()['referrer-policy'] === 'same-origin', 'Native forms retain a same-origin Origin header');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Consent fits on mobile');
  await page.locator('[name=consent]').check();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/agents' && url.searchParams.has('code'));
  const callback = new URL(page.url());
  assert(callback.searchParams.get('state') === 'browser-test-state', 'State is preserved');
  assert(callback.searchParams.get('iss') === origin, 'Issuer matches the notebook');
  const exchanged = await page.request.post(origin + '/oauth/token', {
    form: {
      grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: origin + '/agents',
      resource: origin + '/mcp', code_verifier: verifier, code: callback.searchParams.get('code'),
    },
  });
  assert(exchanged.status() === 200, 'Authorization code exchanges in real D1');
  const tokens = await exchanged.json();
  const initialized = await page.request.post(origin + '/mcp', {
    headers: { Authorization: 'Bearer ' + tokens.access_token, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'browser-test', version: '1' } } },
  });
  assert(initialized.status() === 200, 'OAuth access token authenticates to MCP');
  const form = { grant_type: 'refresh_token', client_id: client.client_id, resource: origin + '/mcp', refresh_token: tokens.refresh_token };
  const rotated = await page.request.post(origin + '/oauth/token', { form });
  assert(rotated.status() === 200, 'Refresh token rotates in real D1');
  const fresh = await rotated.json();
  assert(fresh.refresh_token !== tokens.refresh_token, 'Rotation replaces the refresh token');
  const replay = await page.request.post(origin + '/oauth/token', { form });
  assert(replay.status() === 400, 'Replaying a refresh token fails');
  const revoked = await page.request.get(origin + '/mcp', { headers: { Authorization: 'Bearer ' + fresh.access_token } });
  assert(revoked.status() === 401, 'Detected refresh replay revokes the connection');
  // Remove the short-lived authorization code from browser history after the test.
  await page.goto(origin + '/agents');
  return { consent: true, codeExchange: true, mcpAuthentication: true, refreshRotation: true, replayRevocation: true, mobileOverflow: false };
}
