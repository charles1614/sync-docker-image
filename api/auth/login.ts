import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUserClient } from '../_lib/db.js';
import { sendSuccess, sendError } from '../_lib/auth.js';
import { setCorsHeaders } from '../_lib/cors.js';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '../_lib/rateLimit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  if (setCorsHeaders(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405);
  }

  // Apply rate limiting
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit(`login:${clientId}`, RATE_LIMITS.login);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMITS.login.maxRequests.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', new Date(rateLimit.resetTime).toISOString());

  if (!rateLimit.allowed) {
    return sendError(res, 'Too many login attempts. Please try again later.', 429);
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 'Email and password are required');
    }

    const supabase = createUserClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Log detailed error server-side
      console.error('Login error:', error);
      // Return generic error to client
      return sendError(res, 'Invalid email or password', 401);
    }

    return sendSuccess(res, {
      user: data.user,
      session: data.session,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return sendError(res, 'An error occurred during login', 500);
  }
}
