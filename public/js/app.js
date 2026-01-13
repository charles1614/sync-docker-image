// Main application logic

import { checkAuth, logout } from './auth.js';
import { createSyncJob, listSyncJobs, getSyncJob } from './api.js';

// Check authentication on page load
await checkAuth();

// Handle logout
document.getElementById('logoutBtn').addEventListener('click', logout);

// Handle sync form submission
document.getElementById('syncForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const sourceImage = document.getElementById('sourceImage').value;
  let destinationImage = document.getElementById('destinationImage').value.trim();
  const workflowType = document.getElementById('workflowType').value;
  const formError = document.getElementById('formError');

  formError.classList.add('hidden');

  const DEFAULT_REGISTRY = 'registry.cn-shenzhen.aliyuncs.com/charles1416';

  // Auto-fill destination image logic
  if (!destinationImage) {
    // If empty, extract image:tag from source and prepend default registry
    const imageTag = extractImageAndTag(sourceImage);
    destinationImage = `${DEFAULT_REGISTRY}/${imageTag}`;
  } else if (!destinationImage.includes('/')) {
    // If only image:tag provided (no registry), prepend default registry
    destinationImage = `${DEFAULT_REGISTRY}/${destinationImage}`;
  }

  try {
    const result = await createSyncJob(sourceImage, destinationImage, workflowType);

    // Clear form
    document.getElementById('syncForm').reset();

    // Refresh jobs list
    await loadJobs();

    // Show success message (optional)
    alert('Sync job created successfully!');
  } catch (error) {
    formError.textContent = error.message || 'Failed to create sync job';
    formError.classList.remove('hidden');
  }
});

// Extract just the image name and tag from a full image URL
function extractImageAndTag(imageUrl) {
  // Remove registry (everything before the last slash that contains a dot)
  let remaining = imageUrl;

  // If it has a registry (contains dot and slash), remove it
  if (remaining.match(/\.[^/]+\//)) {
    const parts = remaining.split('/');
    remaining = parts[parts.length - 1]; // Get last part (image:tag)
  } else if (remaining.includes('/')) {
    // Handle docker.io/library/nginx format
    const parts = remaining.split('/');
    remaining = parts[parts.length - 1]; // Get last part (image:tag)
  }

  return remaining;
}

// Load and display jobs
async function loadJobs() {
  const container = document.getElementById('jobsContainer');

  try {
    const { jobs } = await listSyncJobs({ limit: 50 });

    if (jobs.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No sync jobs yet</p>';
      return;
    }

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${jobs.map(job => renderJobRow(job)).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    console.error('Failed to load jobs:', error);
    container.innerHTML = '<p class="text-red-600 text-sm">Failed to load sync jobs</p>';
  }
}

function renderJobRow(job) {
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  const statusColor = statusColors[job.status] || 'bg-gray-100 text-gray-800';
  const createdAt = new Date(job.created_at).toLocaleString();

  return `
    <tr data-job-id="${job.id}">
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        ${escapeHtml(job.source_repo)}
      </td>
      <td class="px-6 py-4 text-sm text-gray-900">
        <div class="flex items-center">
          <span class="truncate max-w-xs" title="${escapeHtml(job.destination_repo)}">
            ${escapeHtml(job.destination_repo)}
          </span>
          ${job.status === 'success' ? `
            <button
              onclick="copyToClipboard('${escapeHtml(job.destination_registry)}/${escapeHtml(job.destination_repo)}')"
              class="ml-2 text-indigo-600 hover:text-indigo-900"
              title="Copy full image URL"
            >
              📋
            </button>
          ` : ''}
        </div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        ${job.workflow_type}
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}">
          ${job.status}
        </span>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        ${createdAt}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        ${job.logs_url ? `
          <a href="${job.logs_url}" target="_blank" class="text-indigo-600 hover:text-indigo-900">
            View Logs
          </a>
        ` : '-'}
      </td>
    </tr>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Copy to clipboard function (global for onclick)
window.copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    alert('Copied to clipboard: ' + text);
  } catch (error) {
    console.error('Failed to copy:', error);
    alert('Failed to copy to clipboard');
  }
};

// Auto-refresh jobs every 10 seconds
setInterval(async () => {
  await loadJobs();
}, 10000);

// Initial load
await loadJobs();
