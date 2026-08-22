import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { db } from '../_lib/db.js';
import { parseImageUrl, triggerWorkflow } from '../_lib/github.js';
import { refreshJob } from '../_lib/jobStatus.js';
import type { CreateSyncJobRequest } from '../_lib/types.js';
import { setCorsHeaders } from '../_lib/cors.js';
import { validateImageUrl, validateWorkflowType } from '../_lib/validation.js';
import { normalizeDestination } from '../_lib/imageDefaults.js';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '../_lib/rateLimit.js';

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  // GET - List all sync jobs
  if (req.method === 'GET') {
    try {
      const { status, limit, offset, search } = req.query;

      const result = await db.listSyncJobs(req.user!.id, {
        status: status as string | undefined,
        limit: limit ? parseInt(limit as string) : 10,
        offset: offset ? parseInt(offset as string) : 0,
        search: search as string | undefined,
      });

      // Bring running jobs up to date with GitHub. Independent per job, so
      // run them concurrently rather than one after another.
      const updatedJobs = await Promise.all(
        result.jobs.map(async (job) => {
          const { job: refreshed } = await refreshJob(job, req.user!.id);
          return refreshed;
        })
      );

      return sendSuccess(res, {
        jobs: updatedJobs,
        total: result.total,
        limit: limit ? parseInt(limit as string) : 10,
        offset: offset ? parseInt(offset as string) : 0,
      });
    } catch (error: any) {
      console.error('Failed to list jobs:', error);
      return sendError(res, 'Failed to retrieve sync jobs', 500);
    }
  }

  // POST - Create new sync job
  if (req.method === 'POST') {
    // Apply rate limiting for job creation
    const clientId = getClientIdentifier(req);
    const rateLimit = checkRateLimit(`createJob:${clientId}`, RATE_LIMITS.createJob);

    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.createJob.maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateLimit.resetTime).toISOString());

    if (!rateLimit.allowed) {
      return sendError(res, 'Too many sync job requests. Please try again later.', 429);
    }

    try {
      const { source_image, destination_image, workflow_type }: CreateSyncJobRequest = req.body;

      if (!source_image) {
        return sendError(res, 'source_image is required');
      }

      // Validate source image. Use the normalized value from here on -- the
      // raw request field may carry whitespace that would otherwise reach the
      // workflow inputs verbatim.
      const sourceValidation = validateImageUrl(source_image);
      if (!sourceValidation.valid) {
        return sendError(res, `Invalid source image: ${sourceValidation.error}`);
      }
      const sourceImage = sourceValidation.value!;

      // Validate workflow type if provided
      if (workflow_type) {
        const workflowValidation = validateWorkflowType(workflow_type);
        if (!workflowValidation.valid) {
          return sendError(res, workflowValidation.error!);
        }
      }

      const sourceParts = parseImageUrl(sourceImage);

      // Determine workflow type if not specified
      let finalWorkflowType: 'copy' | 'sync' = workflow_type || 'copy';

      // If source has a tag, use copy. If not, could be sync
      if (!sourceParts.tag && workflow_type !== 'copy') {
        finalWorkflowType = 'sync';
      }

      // Fill in registry/scope defaults so API clients (the CLI) can pass a bare
      // repo path, or omit the destination entirely. Already-qualified values,
      // such as the ones the web form sends, pass through untouched.
      const resolvedDestination = normalizeDestination(
        sourceImage,
        destination_image,
        finalWorkflowType
      );

      // Validate destination image
      const destValidation = validateImageUrl(resolvedDestination);
      if (!destValidation.valid) {
        return sendError(res, `Invalid destination image: ${destValidation.error}`);
      }
      const destinationImage = destValidation.value!;

      const destParts = parseImageUrl(destinationImage);

      // Create sync job in database
      const job = await db.createSyncJob({
        user_id: req.user!.id,
        workflow_type: finalWorkflowType,
        source_registry: sourceParts.registry,
        source_repo: sourceImage,
        destination_registry: destParts.registry,
        destination_repo: destinationImage,
        status: 'pending',
      });

      // Trigger GitHub Actions workflow
      try {
        const { run_id, run_number } = await triggerWorkflow(job);

        // Update job with run information
        const updatedJob = await db.updateSyncJob(job.id, req.user!.id, {
          github_run_id: run_id?.toString(),
          github_run_number: run_number,
          status: 'running',
          started_at: new Date().toISOString(),
        });

        return sendSuccess(res, { job: updatedJob }, 201);
      } catch (error: any) {
        // Log detailed error
        console.error('Failed to trigger workflow:', error);

        // Update job status to failed
        await db.updateSyncJob(job.id, req.user!.id, {
          status: 'failed',
          error_message: 'Failed to trigger workflow',
        });

        return sendError(res, 'Failed to start sync job', 500);
      }
    } catch (error: any) {
      console.error('Failed to create job:', error);
      return sendError(res, 'Failed to create sync job', 500);
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
