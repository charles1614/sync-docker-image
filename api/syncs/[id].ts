import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { db } from '../_lib/db.js';
import { getWorkflowStatus, getWorkflowProgress } from '../_lib/github.js';
import { setCorsHeaders } from '../_lib/cors.js';

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return sendError(res, 'Job ID is required');
  }

  // GET - Get single sync job.
  // Pass ?progress=1 to also get step-level GitHub Actions progress.
  if (req.method === 'GET') {
    const wantProgress = req.query.progress === '1' || req.query.progress === 'true';

    try {
      // Get job from database
      const job = await db.getSyncJob(id, req.user!.id);

      if (!job) {
        return sendError(res, 'Job not found', 404);
      }

      let currentJob = job;
      let progress = null;

      const needsGitHub = Boolean(job.github_run_id) && (job.status === 'running' || wantProgress);

      if (needsGitHub) {
        try {
          // getWorkflowProgress already reports run status/conclusion, so when
          // progress is requested we skip the extra getWorkflowRun call the
          // CLI would otherwise trigger on every poll.
          if (wantProgress) {
            progress = await getWorkflowProgress(job.github_run_id!);
          }

          const status = progress ?? (await getWorkflowStatus(job.github_run_id!));

          // Update job if status changed
          if (job.status === 'running' && status.status === 'completed') {
            const isSuccess = status.conclusion === 'success';

            currentJob = await db.updateSyncJob(job.id, req.user!.id, {
              status: isSuccess ? 'success' : 'failed',
              conclusion: status.conclusion || undefined,
              completed_at: new Date().toISOString(),
              logs_url: status.html_url,
            });

            // Auto-cleanup old successful jobs
            if (isSuccess) {
              try {
                const deletedCount = await db.deleteOlderSuccessfulJobs(
                  req.user!.id,
                  job.source_repo,
                  job.id
                );
                if (deletedCount > 0) {
                  console.log(`Cleaned up ${deletedCount} old successful jobs for ${job.source_repo}`);
                }
              } catch (error) {
                console.error('Failed to auto-cleanup old jobs:', error);
                // Don't fail the request if cleanup fails
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch GitHub status:', error);
          // GitHub data is best-effort; fall back to what the database knows
        }
      }

      return wantProgress
        ? sendSuccess(res, { job: currentJob, progress })
        : sendSuccess(res, { job: currentJob });
    } catch (error: any) {
      console.error('Failed to get job:', error);
      return sendError(res, 'Failed to retrieve sync job', 500);
    }
  }

  // DELETE - Delete sync job
  if (req.method === 'DELETE') {
    try {
      // Verify the job exists and belongs to the user
      const job = await db.getSyncJob(id, req.user!.id);

      if (!job) {
        return sendError(res, 'Job not found', 404);
      }

      // Delete the job
      await db.deleteSyncJob(id, req.user!.id);

      return sendSuccess(res, { message: 'Job deleted successfully' });
    } catch (error: any) {
      console.error('Failed to delete job:', error);
      return sendError(res, 'Failed to delete sync job', 500);
    }
  }

  return sendError(res, 'Method not allowed', 405);
}

export default async function (req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  if (setCorsHeaders(req, res)) {
    return; // Preflight request handled
  }

  return requireAuth(req as AuthenticatedRequest, res, handler);
}
