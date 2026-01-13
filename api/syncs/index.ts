import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { db } from '../_lib/db.js';
import { parseImageUrl, triggerWorkflow, getWorkflowStatus } from '../_lib/github.js';
import type { CreateSyncJobRequest } from '../_lib/types.js';

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  // GET - List all sync jobs
  if (req.method === 'GET') {
    try {
      const { status, limit } = req.query;

      const jobs = await db.listSyncJobs(req.user!.id, {
        status: status as string | undefined,
        limit: limit ? parseInt(limit as string) : 50,
      });

      // Update status for running jobs by checking GitHub
      const updatedJobs = await Promise.all(
        jobs.map(async (job) => {
          // Only check GitHub if job is running and has a run_id
          if (job.status === 'running' && job.github_run_id) {
            try {
              const githubStatus = await getWorkflowStatus(job.github_run_id);

              // Update job if GitHub workflow is completed
              if (githubStatus.status === 'completed') {
                const isSuccess = githubStatus.conclusion === 'success';

                const updated = await db.updateSyncJob(job.id, {
                  status: isSuccess ? 'success' : 'failed',
                  conclusion: githubStatus.conclusion || undefined,
                  completed_at: new Date().toISOString(),
                  logs_url: githubStatus.html_url,
                });

                return updated;
              }
            } catch (error) {
              console.error(`Failed to update status for job ${job.id}:`, error);
              // Continue with original job data if GitHub check fails
            }
          }

          return job;
        })
      );

      return sendSuccess(res, { jobs: updatedJobs });
    } catch (error: any) {
      console.error('Failed to list jobs:', error);
      return sendError(res, error.message || 'Failed to list sync jobs', 500);
    }
  }

  // POST - Create new sync job
  if (req.method === 'POST') {
    try {
      const { source_image, destination_image, workflow_type }: CreateSyncJobRequest = req.body;

      if (!source_image || !destination_image) {
        return sendError(res, 'source_image and destination_image are required');
      }

      // Parse image URLs
      const sourceParts = parseImageUrl(source_image);
      const destParts = parseImageUrl(destination_image);

      // Determine workflow type if not specified
      let finalWorkflowType: 'copy' | 'sync' = workflow_type || 'copy';

      // If source has a tag, use copy. If not, could be sync
      if (!sourceParts.tag && workflow_type !== 'copy') {
        finalWorkflowType = 'sync';
      }

      // Create sync job in database
      const job = await db.createSyncJob({
        user_id: req.user!.id,
        workflow_type: finalWorkflowType,
        source_registry: sourceParts.registry,
        source_repo: source_image,
        destination_registry: destParts.registry,
        destination_repo: destination_image,
        status: 'pending',
      });

      // Trigger GitHub Actions workflow
      try {
        const { run_id, run_number } = await triggerWorkflow(job);

        // Update job with run information
        const updatedJob = await db.updateSyncJob(job.id, {
          github_run_id: run_id?.toString(),
          github_run_number: run_number,
          status: 'running',
          started_at: new Date().toISOString(),
        });

        return sendSuccess(res, { job: updatedJob }, 201);
      } catch (error: any) {
        // Update job status to failed
        await db.updateSyncJob(job.id, {
          status: 'failed',
          error_message: error.message || 'Failed to trigger workflow',
        });

        return sendError(res, 'Failed to trigger GitHub workflow: ' + error.message, 500);
      }
    } catch (error: any) {
      console.error('Failed to create job:', error);
      return sendError(res, error.message || 'Failed to create sync job', 500);
    }
  }

  return sendError(res, 'Method not allowed', 405);
}

export default async function (req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return requireAuth(req as AuthenticatedRequest, res, handler);
}
