import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, type AuthenticatedRequest } from '../_lib/auth.js';
import { setCorsHeaders } from '../_lib/cors.js';

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  return sendSuccess(res, { user: req.user });
}

export default async function (req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  if (setCorsHeaders(req, res)) {
    return; // Preflight request handled
  }

  return requireAuth(req as AuthenticatedRequest, res, handler);
}
