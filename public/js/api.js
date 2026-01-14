// API client functions

import { getToken } from './auth.js';

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Request failed');
  }

  return data.data;
}

export async function createSyncJob(sourceImage, destinationImage, workflowType = 'copy') {
  return request('/syncs', {
    method: 'POST',
    body: JSON.stringify({
      source_image: sourceImage,
      destination_image: destinationImage,
      workflow_type: workflowType,
    }),
  });
}

export async function listSyncJobs(params = {}) {
  const queryParams = new URLSearchParams();

  if (params.status) {
    queryParams.append('status', params.status);
  }

  if (params.limit) {
    queryParams.append('limit', params.limit.toString());
  }

  if (params.offset) {
    queryParams.append('offset', params.offset.toString());
  }

  if (params.search) {
    queryParams.append('search', params.search);
  }

  const queryString = queryParams.toString();
  const endpoint = `/syncs${queryString ? '?' + queryString : ''}`;

  return request(endpoint);
}

export async function getSyncJob(jobId) {
  return request(`/syncs/${jobId}`);
}

export async function deleteSyncJob(jobId) {
  return request(`/syncs/${jobId}`, {
    method: 'DELETE',
  });
}
