import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUserClient } from './db.js';

export interface AuthenticatedRequest extends VercelRequest {
  user?: {
    id: string;
    email?: string;
  };
}

// Middleware to verify authentication
export async function requireAuth(
  req: AuthenticatedRequest,
  res: VercelResponse,
  handler: (req: AuthenticatedRequest, res: VercelResponse) => Promise<VercelResponse>
) {
  try {
    // Get access token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid authorization header',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const supabase = createUserClient(token);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
    };

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
