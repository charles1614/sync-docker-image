// API token management page

import { checkAuth, logout } from './auth.js';
import { listApiTokens, createApiToken, revokeApiToken } from './api.js';

const user = await checkAuth();

// If checkAuth returned null, we're redirecting - don't continue
if (!user) {
  throw new Error('Redirecting to login');
}

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('cliUrlHint').textContent = window.location.origin;

const newTokenPanel = document.getElementById('newTokenPanel');
const newTokenValue = document.getElementById('newTokenValue');
const loginSnippet = document.getElementById('loginSnippet');
const tokenError = document.getElementById('tokenError');
const createTokenBtn = document.getElementById('createTokenBtn');

document.getElementById('dismissTokenBtn').addEventListener('click', () => {
  newTokenPanel.classList.add('hidden');
  newTokenValue.textContent = '';
  loginSnippet.textContent = '';
});

document.getElementById('copyTokenBtn').addEventListener('click', async () => {
  const button = document.getElementById('copyTokenBtn');

  try {
    await navigator.clipboard.writeText(newTokenValue.textContent);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  } catch (error) {
    console.error('Failed to copy token:', error);
    button.textContent = 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  }
});

document.getElementById('tokenForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('tokenName').value.trim();
  const expiryValue = document.getElementById('tokenExpiry').value;
  const expiresInDays = expiryValue ? parseInt(expiryValue, 10) : null;

  tokenError.classList.add('hidden');

  if (!name) {
    showError('Please give the token a name');
    return;
  }

  createTokenBtn.disabled = true;
  createTokenBtn.textContent = 'Generating…';

  try {
    const { token } = await createApiToken(name, expiresInDays);

    newTokenValue.textContent = token;
    // Deliberately NOT `--token <value>`: that would persist the secret in the
    // user's shell history. `sdi login <url>` prompts for it without echoing.
    loginSnippet.textContent = `sdi login ${window.location.origin}`;
    newTokenPanel.classList.remove('hidden');
    newTokenPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('tokenForm').reset();
    await loadTokens();
  } catch (error) {
    showError(error.message || 'Failed to create token');
  } finally {
    createTokenBtn.disabled = false;
    createTokenBtn.textContent = 'Generate token';
  }
});

function showError(message) {
  tokenError.textContent = message;
  tokenError.classList.remove('hidden');
}

async function loadTokens() {
  const container = document.getElementById('tokensContainer');

  try {
    const { tokens } = await listApiTokens();

    if (tokens.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No tokens yet. Generate one above to use the CLI.</p>';
      return;
    }

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Token</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last used</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${tokens.map(renderTokenRow).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    console.error('Failed to load tokens:', error);
    container.innerHTML = '<p class="text-red-600 text-sm">Failed to load API tokens</p>';
  }
}

function renderTokenRow(token) {
  const expired = token.expires_at && new Date(token.expires_at) <= new Date();

  return `
    <tr>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        ${escapeHtml(token.name)}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
        ${escapeHtml(token.token_prefix)}…
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        ${formatDate(token.created_at)}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        ${token.last_used_at ? formatDate(token.last_used_at) : 'Never'}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm ${expired ? 'text-red-600' : 'text-gray-500'}">
        ${token.expires_at ? formatDate(token.expires_at) + (expired ? ' (expired)' : '') : 'Never'}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <button
          onclick="revokeToken('${token.id}', '${escapeAttr(token.name)}')"
          class="text-red-600 hover:text-red-900"
        >
          Revoke
        </button>
      </td>
    </tr>
  `;
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// For values interpolated into an inline onclick handler
function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// Revoke token (global for onclick)
window.revokeToken = async (tokenId, name) => {
  if (!confirm(`Revoke "${name}"? Any CLI or script using it will stop working immediately.`)) {
    return;
  }

  try {
    await revokeApiToken(tokenId);
    await loadTokens();
  } catch (error) {
    console.error('Failed to revoke token:', error);
    alert('Failed to revoke token: ' + (error.message || 'Unknown error'));
  }
};

await loadTokens();
