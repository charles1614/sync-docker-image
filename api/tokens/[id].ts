import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSessionAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { tokenDb } from '../_lib/apiToken.js';
import { setCorsHeaders } from '../_lib/cors.js';

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return sendError(res, 'Token ID is required');
  }

  if (req.method === 'DELETE') {
    try {
      const revoked = await tokenDb.revoke(id, req.user!.id);

      if (!revoked) {
        return sendError(res, 'Token not found', 404);
      }

      return sendSuccess(res, { message: 'Token revoked successfully' });
    } catch (error: any) {
      console.error('Failed to revoke token:', error);
      return sendError(res, 'Failed to revoke API token', 500);
    }
  }

  return sendError(res, 'Method not allowed', 405);
}

export default async function (req: VercelRequest, res: VercelResponse) {
  if (setCorsHeaders(req, res)) {
    return; // Preflight request handled
  }

  return requireSessionAuth(req as AuthenticatedRequest, res, handler);
}
