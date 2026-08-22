import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUserClient } from './db.js';
import { looksLikeApiToken, verifyApiToken } from './apiToken.js';

export type AuthMode = 'session' | 'token';

export interface AuthenticatedRequest extends VercelRequest {
  user?: {
    id: string;
    email?: string;
    // How the caller authenticated: a browser session (Supabase JWT) or a CLI API token
    auth_mode: AuthMode;
    token_id?: string;
  };
}

function extractBearer(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7).trim() || null;
}

// Resolve the caller from either a Supabase session JWT or an `sdi_` API token
async function resolveUser(token: string): Promise<AuthenticatedRequest['user'] | null> {
  if (looksLikeApiToken(token)) {
    const verified = await verifyApiToken(token);
    if (!verified) return null;

    return {
      id: verified.user_id,
      auth_mode: 'token',
      token_id: verified.token_id,
    };
  }

  const supabase = createUserClient(token);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;

  return {
    id: user.id,
    email: user.email,
    auth_mode: 'session',
  };
}

// Middleware to verify authentication.
// Accepts both browser sessions and CLI API tokens unless `sessionOnly` is set.
export async function requireAuth(
  req: AuthenticatedRequest,
  res: VercelResponse,
  handler: (req: AuthenticatedRequest, res: VercelResponse) => Promise<VercelResponse>,
  options: { sessionOnly?: boolean } = {}
) {
  try {
    const token = extractBearer(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid authorization header',
      });
    }

    const user = await resolveUser(token);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }

    // API tokens must never be able to mint or revoke other API tokens,
    // otherwise a leaked token could keep re-issuing access to itself.
    if (options.sessionOnly && user.auth_mode !== 'session') {
      return res.status(403).json({
        success: false,
        error: 'This endpoint requires a browser session. API tokens cannot manage API tokens.',
      });
    }

    // Attach user to request
    req.user = user;

    // Call the handler
    await handler(req, res);
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

// Same as requireAuth, but rejects API tokens
export async function requireSessionAuth(
  req: AuthenticatedRequest,
  res: VercelResponse,
  handler: (req: AuthenticatedRequest, res: VercelResponse) => Promise<VercelResponse>
) {
  return requireAuth(req, res, handler, { sessionOnly: true });
}

// Helper to send success response
export function sendSuccess<T>(res: VercelResponse, data: T, status: number = 200) {
  return res.status(status).json({
    success: true,
    data,
  });
}

// Helper to send error response
export function sendError(res: VercelResponse, error: string, status: number = 400) {
  return res.status(status).json({
    success: false,
    error,
  });
}
