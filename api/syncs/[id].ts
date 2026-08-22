import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { db } from '../_lib/db.js';
import { refreshJob } from '../_lib/jobStatus.js';
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
      const existing = await db.getSyncJob(id, req.user!.id);

      if (!existing) {
        return sendError(res, 'Job not found', 404);
      }

      const { job, progress } = await refreshJob(existing, req.user!.id, {
        withProgress: wantProgress,
      });

      return wantProgress ? sendSuccess(res, { job, progress }) : sendSuccess(res, { job });
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
