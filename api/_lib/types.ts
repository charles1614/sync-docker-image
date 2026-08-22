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
  // Optional: the server fills in the default registry/scope when omitted
  destination_image?: string;
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

// API tokens (used by the CLI / automation harnesses)
export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
}

// Safe representation returned to clients (never includes the hash)
export interface ApiTokenPublic {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
}

export interface CreateApiTokenRequest {
  name: string;
  expires_in_days?: number | null;
}

// A single step of the running GitHub Actions job, used for progress reporting
export interface WorkflowStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  number: number;
}

export interface WorkflowProgress {
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  html_url: string;
  steps: WorkflowStep[];
  current_step?: string | null;
  completed_steps: number;
  total_steps: number;
}
