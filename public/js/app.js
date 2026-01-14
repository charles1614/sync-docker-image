// Main application logic

import { checkAuth, logout } from './auth.js';
import { createSyncJob, listSyncJobs, getSyncJob, deleteSyncJob } from './api.js';

// Pagination and filter state
let currentPage = 1;
let currentSearch = '';
let currentStatusFilter = '';
const itemsPerPage = 10;

// Check authentication on page load
const user = await checkAuth();

// If checkAuth returned null, we're redirecting - don't continue
if (!user) {
  // Keep loading screen visible during redirect
  throw new Error('Redirecting to login');
}

// Handle logout
document.getElementById('logoutBtn').addEventListener('click', logout);

// Handle search input with debouncing
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = e.target.value;
    currentPage = 1;
    loadJobs();
  }, 500); // Debounce 500ms
});

// Handle status filter
document.getElementById('statusFilter').addEventListener('change', (e) => {
  currentStatusFilter = e.target.value;
  currentPage = 1;
  loadJobs();
});

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
    // If empty, extract image:tag from source and prepend default registry/scope
    const imageTag = extractImageAndTag(sourceImage);
    destinationImage = `${DEFAULT_REGISTRY}/${imageTag}`;
  } else {
    // CRITICAL FIX: Always extract just the repo path, removing any registry
    // This handles cases where users paste full URLs
    const repoPath = extractRepoPath(destinationImage);

    // If it's just "image:tag" without scope, add default scope
    if (!repoPath.includes('/')) {
      destinationImage = `${DEFAULT_REGISTRY}/${repoPath}`;
    } else {
      // Has scope (e.g., "charles1416/cuda:tag"), add only registry
      destinationImage = `registry.cn-shenzhen.aliyuncs.com/${repoPath}`;
    }
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

// Parse image URL into components (mirrors backend parseImageUrl)
function parseImageUrl(imageUrl) {
  const parts = {
    registry: 'docker.io',
    repo: '',
    scope: null,
    tag: null
  };

  let remaining = imageUrl;

  // Extract tag (handle multi-part tags like "13.1.0-devel-ubuntu24.04")
  if (remaining.includes(':')) {
    const lastColonIndex = remaining.lastIndexOf(':');
    const potentialTag = remaining.substring(lastColonIndex + 1);
    // Verify it's a tag, not a port in registry URL
    if (!remaining.substring(0, lastColonIndex).includes('/') ||
        remaining.substring(0, lastColonIndex).lastIndexOf('/') > remaining.lastIndexOf('.')) {
      parts.tag = potentialTag;
      remaining = remaining.substring(0, lastColonIndex);
    }
  }

  // Extract registry (contains dot and slash, e.g., "registry.cn-shenzhen.aliyuncs.com/")
  if (remaining.match(/\.[^/]+\//)) {
    const segments = remaining.split('/');
    parts.registry = segments[0];
    remaining = segments.slice(1).join('/');
  }

  // Extract scope and repo (e.g., "charles1416/cuda" -> scope: charles1416, repo: cuda)
  if (remaining.includes('/')) {
    const segments = remaining.split('/');
    if (segments.length >= 2) {
      parts.scope = segments[segments.length - 2];
      parts.repo = segments[segments.length - 1];
    } else {
      parts.repo = segments[segments.length - 1];
    }
  } else {
    parts.repo = remaining;
  }

  return parts;
}

// Extract repo path without registry (e.g., "charles1416/cuda:tag")
function extractRepoPath(imageUrl) {
  const parts = parseImageUrl(imageUrl);

  // Build repo path: [scope/]repo[:tag]
  let repoPath = '';
  if (parts.scope) {
    repoPath = `${parts.scope}/${parts.repo}`;
  } else {
    repoPath = parts.repo;
  }

  if (parts.tag) {
    repoPath += `:${parts.tag}`;
  }

  return repoPath;
}

// Load and display jobs
async function loadJobs() {
  const container = document.getElementById('jobsContainer');

  try {
    const offset = (currentPage - 1) * itemsPerPage;
    const params = {
      limit: itemsPerPage,
      offset: offset
    };

    if (currentSearch) {
      params.search = currentSearch;
    }

    if (currentStatusFilter) {
      params.status = currentStatusFilter;
    }

    const { jobs, total } = await listSyncJobs(params);

    if (jobs.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No sync jobs found</p>';
      return;
    }

    const totalPages = Math.ceil(total / itemsPerPage);

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

      ${totalPages > 1 ? renderPagination(totalPages) : ''}
    `;
  } catch (error) {
    console.error('Failed to load jobs:', error);
    container.innerHTML = '<p class="text-red-600 text-sm">Failed to load sync jobs</p>';
  }
}

// Render pagination UI
function renderPagination(totalPages) {
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  let pages = [];

  // Previous button
  pages.push(`
    <button
      onclick="changePage(${currentPage - 1})"
      ${currentPage === 1 ? 'disabled' : ''}
      class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium ${currentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'}"
    >
      «
    </button>
  `);

  // Page numbers
  for (let i = startPage; i <= endPage; i++) {
    pages.push(`
      <button
        onclick="changePage(${i})"
        class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium ${i === currentPage ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600' : 'bg-white text-gray-700 hover:bg-gray-50'}"
      >
        ${i}
      </button>
    `);
  }

  // Next button
  pages.push(`
    <button
      onclick="changePage(${currentPage + 1})"
      ${currentPage === totalPages ? 'disabled' : ''}
      class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium ${currentPage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:bg-gray-50'}"
    >
      »
    </button>
  `);

  return `
    <div class="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6 mt-4">
      <div class="flex-1 flex justify-between sm:hidden">
        <button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
          Previous
        </button>
        <button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
          Next
        </button>
      </div>
      <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          <p class="text-sm text-gray-700">
            Page <span class="font-medium">${currentPage}</span> of <span class="font-medium">${totalPages}</span>
          </p>
        </div>
        <div>
          <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            ${pages.join('')}
          </nav>
        </div>
      </div>
    </div>
  `;
}

// Change page function (global for onclick)
window.changePage = (page) => {
  currentPage = page;
  loadJobs();
};

function renderJobRow(job) {
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  const statusColor = statusColors[job.status] || 'bg-gray-100 text-gray-800';
  const createdAt = new Date(job.created_at).toLocaleString();

  // Build full destination URL, handling both old and new data formats
  let fullDestinationUrl;
  if (job.destination_repo.match(/\.[^/]+\//)) {
    // destination_repo already contains registry (old format)
    fullDestinationUrl = job.destination_repo;
  } else {
    // destination_repo is just the repo path (new format)
    fullDestinationUrl = `${job.destination_registry}/${job.destination_repo}`;
  }

  return `
    <tr data-job-id="${job.id}">
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        ${escapeHtml(job.source_repo)}
      </td>
      <td class="px-6 py-4 text-sm text-gray-900">
        <div class="flex items-center">
          <span class="truncate max-w-xs" title="${escapeHtml(fullDestinationUrl)}">
            ${escapeHtml(fullDestinationUrl)}
          </span>
          ${job.status === 'success' ? `
            <button
              onclick="copyToClipboard('${escapeHtml(fullDestinationUrl)}')"
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
        <div class="flex space-x-2">
          ${job.logs_url ? `
            <a href="${job.logs_url}" target="_blank" class="text-indigo-600 hover:text-indigo-900">
              View Logs
            </a>
          ` : ''}
          <button
            onclick="deleteJob('${job.id}')"
            class="text-red-600 hover:text-red-900"
            title="Delete job"
          >
            Delete
          </button>
        </div>
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

// Delete job function (global for onclick)
window.deleteJob = async (jobId) => {
  if (!confirm('Are you sure you want to delete this job? This action cannot be undone.')) {
    return;
  }

  try {
    await deleteSyncJob(jobId);

    // Refresh the jobs list
    await loadJobs();

    alert('Job deleted successfully');
  } catch (error) {
    console.error('Failed to delete job:', error);
    alert('Failed to delete job: ' + (error.message || 'Unknown error'));
  }
};

// Auto-refresh jobs every 10 seconds
setInterval(async () => {
  await loadJobs();
}, 10000);

// Initial load
await loadJobs();
