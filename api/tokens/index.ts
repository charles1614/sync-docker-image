import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSessionAuth, sendSuccess, sendError, type AuthenticatedRequest } from '../_lib/auth.js';
import { tokenDb } from '../_lib/apiToken.js';
import { setCorsHeaders } from '../_lib/cors.js';
import { sanitizeString } from '../_lib/validation.js';
import type { CreateApiTokenRequest } from '../_lib/types.js';

const MAX_ACTIVE_TOKENS = 20;
const MAX_EXPIRY_DAYS = 365;

async function handler(req: AuthenticatedRequest, res: VercelResponse) {
  // GET - list this user's active tokens (metadata only, never the secret)
  if (req.method === 'GET') {
    try {
      const tokens = await tokenDb.list(req.user!.id);
      return sendSuccess(res, { tokens });
    } catch (error: any) {
      console.error('Failed to list tokens:', error);
      return sendError(res, 'Failed to retrieve API tokens', 500);
    }
  }

  // POST - create a new token. The plaintext value is returned exactly once.
  if (req.method === 'POST') {
    try {
      const { name, expires_in_days }: CreateApiTokenRequest = req.body || {};

      const cleanName = sanitizeString(String(name ?? ''), 100);
      if (!cleanName) {
        return sendError(res, 'A token name is required');
      }

      let expiresAt: string | null = null;
      if (expires_in_days !== undefined && expires_in_days !== null) {
        const days = Number(expires_in_days);
        if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
          return sendError(res, `expires_in_days must be between 1 and ${MAX_EXPIRY_DAYS}`);
        }
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }

      const active = await tokenDb.countActive(req.user!.id);
      if (active >= MAX_ACTIVE_TOKENS) {
        return sendError(
          res,
          `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one before creating another.`
        );
      }

      const { token, record } = await tokenDb.create(req.user!.id, cleanName, expiresAt);

      return sendSuccess(res, { token, record }, 201);
    } catch (error: any) {
      console.error('Failed to create token:', error);
      return sendError(res, 'Failed to create API token', 500);
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
