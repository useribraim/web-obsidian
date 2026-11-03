// Browser-only scenarios use intercepted requests, never real notebook credentials.
export default async function testAgents(page, files) {
  const errors = [];
  const rows = [];
  const writes = [];
  let failRead = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://agents.test/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/agent-connections') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        writes.push(body);
        const row = { id: 'test-connection', name: body.name, scopes: body.scopes, expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(), kind: 'pat', revoked_at: null, last_used_at: null };
        rows.push(row);
        return route.fulfill({ status: 201, json: { ...row, token: 'browser-test-token-not-a-real-secret' } });
      }
      return failRead ? route.fulfill({ status: 503, json: { error: 'Connections unavailable.' } }) : route.fulfill({ json: rows });
    }
    if (url.pathname === '/api/agent-connections/test-connection' && request.method() === 'DELETE') {
      rows[0].revoked_at = new Date().toISOString();
      return route.fulfill({ json: { ok: true } });
    }
    const path = url.pathname;
    if (!(path in files)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: files[path], contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.goto('http://agents.test/agents.html');
  await page.waitForFunction(() => document.querySelector('#agent-status').textContent === 'No connections yet.');
  assert(await page.locator('#mcp-url').textContent() === 'http://agents.test/mcp', 'Endpoint uses the current origin');
  assert(await page.locator('[value="notes:create"]').isChecked(), 'Create-only is the default permission');
  assert(!(await page.locator('[value="notes:read"]').isChecked()), 'Read access is opt-in');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `No horizontal overflow at ${width}px`);
  }
  await page.locator('#agent-name').fill('<Research harness>');
  await page.locator('#agent-create').click();
  assert(writes.length === 0, 'Explicit consent is required');
  await page.locator('#agent-consent').check();
  await page.locator('#agent-create').click();
  await page.waitForFunction(() => !document.querySelector('#agent-secret').hidden);
  assert(writes.length === 1, 'One connection created');
  assert(JSON.stringify(writes[0].scopes) === JSON.stringify(['notes:create']), 'Only selected scopes are sent');
  assert(writes[0].grant === 'whole_notebook' && writes[0].consent === true, 'Whole notebook consent is explicit');
  assert(await page.locator('.agent-connection h3').textContent() === '<Research harness>', 'Names render as text, not markup');
  assert(await page.locator('#agent-token').inputValue() === 'browser-test-token-not-a-real-secret', 'Token is visible once');
  await page.locator('#hide-token').click();
  assert(await page.locator('#agent-token').inputValue() === '', 'Hiding token clears it from the input');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.agent-connection').length === 1);
  assert(await page.locator('#agent-secret').isHidden(), 'Reload never retrieves the token');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Revoke <Research harness>', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#agent-status').textContent === 'Connection revoked.');
  assert(Boolean(rows[0].revoked_at), 'Revocation reaches the server');
  assert(await page.locator('.agent-connection.revoked').count() === 1, 'Revocation is visible');
  failRead = true;
  await page.locator('#agent-refresh').click();
  await page.waitForFunction(() => document.querySelector('#agent-status').classList.contains('error'));
  assert(await page.locator('#agent-status').textContent() === 'Connections unavailable.', 'Failed reads are visible');
  assert(errors.length === 0, 'No browser errors: ' + errors.join(', '));
  return { layouts: [320, 390, 768, 1280], created: writes.length, revoked: Boolean(rows[0].revoked_at), errors };
}
