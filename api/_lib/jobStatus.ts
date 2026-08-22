import { db } from './db.js';
import { getWorkflowStatus, getWorkflowProgress, findRunForJob } from './github.js';
import type { SyncJob, WorkflowProgress } from './types.js';

export interface RefreshedJob {
  job: SyncJob;
  progress: WorkflowProgress | null;
}

/**
 * Bring a job up to date with GitHub, and optionally collect step-level
 * progress. Shared by the list and detail endpoints so the status transition,
 * the auto-cleanup and the late run attribution only exist in one place.
 *
 * Every GitHub interaction here is best-effort: on failure the caller still
 * gets whatever the database knows.
 */
export async function refreshJob(
  job: SyncJob,
  userId: string,
  options: { withProgress?: boolean } = {}
): Promise<RefreshedJob> {
  let current = job;
  let progress: WorkflowProgress | null = null;

  // triggerWorkflow only polls briefly for the dispatched run, so a job can
  // reach us still lacking its run id. Attach it now rather than leaving the
  // job stuck in 'running' forever.
  if (!current.github_run_id && current.status === 'running') {
    try {
      const found = await findRunForJob(current);

      if (found) {
        current = await db.updateSyncJob(current.id, userId, {
          github_run_id: String(found.run_id),
          github_run_number: found.run_number,
        });
      }
    } catch (error) {
      console.error(`Failed to attach a run id to job ${current.id}:`, error);
    }
  }

  const needsGitHub =
    Boolean(current.github_run_id) && (current.status === 'running' || Boolean(options.withProgress));

  if (!needsGitHub) {
    return { job: current, progress };
  }

  try {
    // getWorkflowProgress already reports run status and conclusion, so when
    // progress is requested we skip the extra getWorkflowRun call.
    if (options.withProgress) {
      progress = await getWorkflowProgress(current.github_run_id!);
    }

    const status = progress ?? (await getWorkflowStatus(current.github_run_id!));

    if (current.status === 'running' && status.status === 'completed') {
      const isSuccess = status.conclusion === 'success';

      current = await db.updateSyncJob(current.id, userId, {
        status: isSuccess ? 'success' : 'failed',
        conclusion: status.conclusion || undefined,
        completed_at: new Date().toISOString(),
        logs_url: status.html_url,
      });

      if (isSuccess) {
        try {
          const deletedCount = await db.deleteOlderSuccessfulJobs(userId, current.source_repo, current.id);

          if (deletedCount > 0) {
            console.log(`Cleaned up ${deletedCount} old successful jobs for ${current.source_repo}`);
          }
        } catch (error) {
          console.error('Failed to auto-cleanup old jobs:', error);
          // Don't fail the request if cleanup fails
        }
      }
    }
  } catch (error) {
    console.error(`Failed to refresh job ${current.id} from GitHub:`, error);
    // Fall back to what the database knows
  }

  return { job: current, progress };
}
