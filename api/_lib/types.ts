// TypeScript type definitions

export interface SyncJob {
  id: string;
  user_id: string;
  workflow_type: 'copy' | 'sync';
  source_registry: string;
  source_repo: string;
  destination_registry: string;
  destination_repo: string;
  github_run_id?: string;
  github_run_number?: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  conclusion?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  logs_url?: string;
}

export interface CreateSyncJobRequest {
  source_image: string;
  destination_image: string;
  workflow_type?: 'copy' | 'sync';
}

export interface ImageParts {
  registry: string;
  scope?: string;
  repo: string;
  tag?: string;
}

export interface User {
  id: string;
  email?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
