const form = document.querySelector('#agent-form');
const status = document.querySelector('#agent-status');
const connections = document.querySelector('#agent-connections');
const secret = document.querySelector('#agent-secret');
const token = document.querySelector('#agent-token');
const endpoint = location.origin + '/mcp';
document.querySelector('#mcp-url').textContent = endpoint;

function say(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}
async function api(path = '', options) {
  const response = await fetch('/api/agent-connections' + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not manage connections. Please try again.');
  return result;
}
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
const date = value => value ? new Date(value).toLocaleDateString() : 'Not used yet';
async function load() {
  const refresh = document.querySelector('#agent-refresh');
  refresh.disabled = true;
  try {
    const rows = await api();
    connections.replaceChildren();
    for (const connection of rows) {
      const row = document.createElement('div');
      row.className = 'agent-connection';
      const info = document.createElement('div');
      info.append(element('h3', connection.name));
      const scopes = connection.scopes;
      info.append(element('p', scopes.map(scope => scope.replace('notes:', '')).join(' / ')));
      info.append(element('p', connection.kind === 'oauth' ? 'OAuth connection' : 'Personal token'));
      const revoked = Boolean(connection.revoked_at);
      const expired = connection.expires_at && Date.parse(connection.expires_at) <= Date.now();
      info.append(element('p', revoked ? 'Revoked' : expired ? 'Expired' : 'Expires ' + date(connection.expires_at)));
      info.append(element('p', 'Last used: ' + date(connection.last_used_at)));
      row.append(info);
      if (!revoked) {
        const button = element('button', 'Revoke');
        button.className = 'tool';
        button.type = 'button';
        button.setAttribute('aria-label', 'Revoke ' + connection.name);
        button.addEventListener('click', async () => {
          if (!confirm(`Revoke access for "${connection.name}"? Its next request will be blocked.`)) return;
          button.disabled = true;
          try {
            await api('/' + connection.id, { method: 'DELETE' });
            token.value = '';
            secret.hidden = true;
            await load();
            say('Connection revoked.');
          } catch (error) { say(error.message, true); button.disabled = false; }
        });
        row.append(button);
      } else row.classList.add('revoked');
      connections.append(row);
    }
    say(rows.length ? 'Each connection can be revoked independently.' : 'No connections yet.');
  } catch (error) { say(error.message, true); }
  finally { refresh.disabled = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const scopes = [...form.querySelectorAll('[name="scope"]:checked')].map(input => input.value);
  if (!scopes.length) { say('Choose at least one permission.', true); return; }
  const button = document.querySelector('#agent-create');
  button.disabled = true;
  token.value = '';
  secret.hidden = true;
  try {
    const result = await api('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.querySelector('#agent-name').value.trim(),
        scopes,
        grant: 'whole_notebook',
        consent: document.querySelector('#agent-consent').checked,
        expires_in: Number(document.querySelector('#agent-expiry').value) * 86400,
      }),
    });
    await load();
    token.value = result.token;
    secret.hidden = false;
    token.focus();
    token.select();
    say('Token created. It will not be shown again.');
  } catch (error) { say(error.message, true); }
  finally { button.disabled = false; }
});
async function copy(text, description) {
  try { await navigator.clipboard.writeText(text); say(description + ' copied.'); }
  catch { say('Clipboard unavailable. Select the text and copy it manually.', true); }
}
document.querySelector('#copy-url').addEventListener('click', () => copy(endpoint, 'Endpoint URL'));
document.querySelector('#copy-token').addEventListener('click', () => copy(token.value, 'Token'));
document.querySelector('#hide-token').addEventListener('click', () => {
  token.value = '';
  secret.hidden = true;
  document.querySelector('#agent-create').focus();
});
document.querySelector('#agent-refresh').addEventListener('click', load);
window.addEventListener('pagehide', () => { token.value = ''; secret.hidden = true; });
load();
