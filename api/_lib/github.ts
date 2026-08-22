import { Octokit } from '@octokit/rest';
import type { SyncJob, ImageParts, WorkflowStep, WorkflowProgress } from './types.js';

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

  // Extract tag if present. Use the last colon so tags containing dots
  // ("13.1.0-devel-ubuntu24.04") survive, and skip a colon that belongs to a
  // registry port ("localhost:5000/nginx") rather than to a tag.
  const lastColon = remaining.lastIndexOf(':');
  if (lastColon !== -1 && !remaining.slice(lastColon + 1).includes('/')) {
    parts.tag = remaining.slice(lastColon + 1);
    remaining = remaining.slice(0, lastColon);
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

// Marker embedded in the dispatch inputs and echoed back by the workflow's
// run-name, so a run can be matched to the job that dispatched it. Without it
// the only handle is "newest run", which mis-attributes whenever two syncs are
// dispatched close together -- routine now that the CLI can batch them.
export function runMarker(jobId: string): string {
  return `[sdi:${jobId}]`;
}

function workflowFileFor(job: Pick<SyncJob, 'workflow_type'>): string {
  return job.workflow_type === 'copy' ? 'copy.yml' : 'sync.yml';
}

/**
 * Find the run this job dispatched, by matching the marker in its run-name.
 * Returns null when the run has not been created yet (GitHub takes a moment)
 * or when the workflow predates the marker.
 */
export async function findRunForJob(
  job: Pick<SyncJob, 'id' | 'workflow_type' | 'created_at'>
): Promise<{ run_id: number; run_number: number } | null> {
  const marker = runMarker(job.id);

  // Only consider runs that could plausibly belong to this job. The window
  // starts slightly before the row was created to absorb clock skew.
  const createdFrom = new Date(new Date(job.created_at).getTime() - 60_000).toISOString();

  const runs = await octokit.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflowFileFor(job),
    event: 'workflow_dispatch',
    created: `>=${createdFrom}`,
    per_page: 50,
  });

  const match = runs.data.workflow_runs.find((run) => run.name?.includes(marker));

  return match ? { run_id: match.id, run_number: match.run_number } : null;
}

// Trigger GitHub Actions workflow
export async function triggerWorkflow(job: SyncJob): Promise<{ run_id?: number; run_number?: number }> {
  const workflowFile = workflowFileFor(job);

  const sourceParts = parseImageUrl(job.source_repo);
  const destParts = parseImageUrl(job.destination_repo);

  let inputs: Record<string, string>;

  if (job.workflow_type === 'copy') {
    inputs = {
      source: job.source_registry,
      destination: job.destination_registry,
      source_repo: buildRepoString(sourceParts, true),
      destination_repo: buildRepoString(destParts, true),
      job_id: runMarker(job.id),
    };
  } else {
    // sync workflow
    inputs = {
      source: job.source_registry,
      destination: job.destination_registry,
      source_repo: buildRepoString(sourceParts, false), // no tag for sync
      destination_scope: destParts.scope || destParts.repo,
      job_id: runMarker(job.id),
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

  // Poll briefly for the run to appear. Kept short so the whole request stays
  // inside the serverless duration limit; if the run is not visible yet the
  // job is simply attributed later, on the first status read.
  const deadline = Date.now() + 8000;

  while (Date.now() < deadline) {
    await sleep(2000);

    try {
      const found = await findRunForJob(job);
      if (found) return found;
    } catch (error) {
      console.error('Failed to look up dispatched run:', error);
      break;
    }
  }

  // Not found yet -- not an error. attachRunId() picks it up on the next poll.
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

// Get fine-grained progress for a workflow run: which step is executing right
// now, and how many have finished. Used by the CLI's `--wait` progress line.
export async function getWorkflowProgress(runId: number | string): Promise<WorkflowProgress> {
  const runId_ = Number(runId);

  const [run, jobs] = await Promise.all([
    octokit.actions.getWorkflowRun({ owner, repo, run_id: runId_ }),
    octokit.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId_, per_page: 20 }),
  ]);

  const steps: WorkflowStep[] = [];

  for (const job of jobs.data.jobs) {
    for (const step of job.steps || []) {
      steps.push({
        name: step.name,
        status: step.status as WorkflowStep['status'],
        conclusion: step.conclusion ?? null,
        number: step.number,
      });
    }
  }

  const inProgress = steps.find((s) => s.status === 'in_progress');
  const completedSteps = steps.filter((s) => s.status === 'completed').length;

  return {
    status: run.data.status as WorkflowProgress['status'],
    conclusion: run.data.conclusion as string | null,
    html_url: run.data.html_url,
    steps,
    current_step: inProgress?.name ?? null,
    completed_steps: completedSteps,
    total_steps: steps.length,
  };
}
