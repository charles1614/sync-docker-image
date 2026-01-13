import { Octokit } from '@octokit/rest';
import type { SyncJob, ImageParts } from './types.js';

const githubToken = process.env.GITHUB_TOKEN;
const githubRepository = process.env.GITHUB_REPOSITORY;

if (!githubToken || !githubRepository) {
  throw new Error('Missing GitHub environment variables');
}

const [owner, repo] = githubRepository.split('/');

const octokit = new Octokit({
  auth: githubToken,
});

// Parse Docker image URL into parts (based on exec.sh check_repo function)
export function parseImageUrl(imageUrl: string): ImageParts {
  const parts: ImageParts = {
    registry: 'docker.io',
    repo: '',
  };

  let remaining = imageUrl;

  // Extract tag if present
  if (remaining.includes(':')) {
    const [beforeTag, tag] = remaining.split(':');
    parts.tag = tag;
    remaining = beforeTag;
  }

  // Extract registry if present (contains dot and slash)
  if (remaining.match(/\.[^/]+\//)) {
    const segments = remaining.split('/');
    parts.registry = segments[0];
    remaining = segments.slice(1).join('/');
  }

  // Extract scope and repo
  if (remaining.includes('/')) {
    const segments = remaining.split('/');
    if (segments.length >= 2) {
      parts.scope = segments[segments.length - 2];
      parts.repo = segments[segments.length - 1];
    }
  } else {
    parts.repo = remaining;
  }

  return parts;
}

// Build repo string from parts (for GitHub workflow inputs)
export function buildRepoString(parts: ImageParts, includeTag: boolean = true): string {
  const segments = [];

  if (parts.scope) {
    segments.push(parts.scope);
  }

  segments.push(parts.repo);

  let result = segments.join('/');

  if (includeTag && parts.tag) {
    result += ':' + parts.tag;
  }

  return result;
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Trigger GitHub Actions workflow
export async function triggerWorkflow(job: SyncJob): Promise<{ run_id?: number; run_number?: number }> {
  const workflowFile = job.workflow_type === 'copy' ? 'copy.yml' : 'sync.yml';

  const sourceParts = parseImageUrl(job.source_repo);
  const destParts = parseImageUrl(job.destination_repo);

  let inputs: Record<string, string>;

  if (job.workflow_type === 'copy') {
    inputs = {
      source: job.source_registry,
      destination: job.destination_registry,
      source_repo: buildRepoString(sourceParts, true),
      destination_repo: buildRepoString(destParts, true),
    };
  } else {
    // sync workflow
    inputs = {
      source: job.source_registry,
      destination: job.destination_registry,
      source_repo: buildRepoString(sourceParts, false), // no tag for sync
      destination_scope: destParts.scope || destParts.repo,
    };
  }

  // Trigger the workflow
  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowFile,
    ref: 'main',
    inputs,
  });

  // Wait for workflow to appear in the list
  await sleep(10000);

  // Try to get the run ID
  try {
    const runs = await octokit.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowFile,
      per_page: 5,
    });

    // Find the most recent run that matches our workflow
    const recentRun = runs.data.workflow_runs[0];

    if (recentRun) {
      return {
        run_id: recentRun.id,
        run_number: recentRun.run_number,
      };
    }
  } catch (error) {
    console.error('Failed to get run ID:', error);
  }

  return {};
}

// Get workflow run status
export async function getWorkflowStatus(runId: number | string) {
  const run = await octokit.actions.getWorkflowRun({
    owner,
    repo,
    run_id: Number(runId),
  });

  return {
    status: run.data.status as 'queued' | 'in_progress' | 'completed',
    conclusion: run.data.conclusion as string | null,
    html_url: run.data.html_url,
    run_number: run.data.run_number,
  };
}
