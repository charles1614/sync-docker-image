import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { db } from '../_lib/db.js';
import { getWorkflowStatus } from '../_lib/github.js';
import { setCorsHeaders } from '../_lib/cors.js';

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return sendError(res, 'Method not allowed', 405);
  }

  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return sendError(res, 'Job ID is required');
    }

    // Get job from database
    const job = await db.getSyncJob(id, req.user!.id);

    if (!job) {
      return sendError(res, 'Job not found', 404);
    }

    // If job is running and has a run_id, fetch latest status from GitHub
    if (job.status === 'running' && job.github_run_id) {
      try {
        const status = await getWorkflowStatus(job.github_run_id);

        // Update job if status changed
        if (status.status === 'completed') {
          const isSuccess = status.conclusion === 'success';

          const updatedJob = await db.updateSyncJob(job.id, req.user!.id, {
            status: isSuccess ? 'success' : 'failed',
            conclusion: status.conclusion || undefined,
            completed_at: new Date().toISOString(),
            logs_url: status.html_url,
          });

          return sendSuccess(res, { job: updatedJob });
        }
      } catch (error) {
        console.error('Failed to fetch GitHub status:', error);
        // Continue with database job data
      }
    }

    return sendSuccess(res, { job });
  } catch (error: any) {
    console.error('Failed to get job:', error);
    return sendError(res, 'Failed to retrieve sync job', 500);
  }
}

export default async function (req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  if (setCorsHeaders(req, res)) {
    return; // Preflight request handled
  }

  return requireAuth(req as AuthenticatedRequest, res, handler);
}
