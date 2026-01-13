import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, sendSuccess, type AuthenticatedRequest } from '../_lib/auth.js';

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
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return requireAuth(req as AuthenticatedRequest, res, handler);
}
