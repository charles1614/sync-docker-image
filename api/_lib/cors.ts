import type { VercelRequest, VercelResponse } from '@vercel/node';

// Allowed origins - add your production domain here
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  // Add your production domain when deployed
  // e.g., 'https://yourdomain.com'
];

// Add environment variable support for additional origins
if (process.env.ALLOWED_ORIGINS) {
  ALLOWED_ORIGINS.push(...process.env.ALLOWED_ORIGINS.split(','));
}

export function setCorsHeaders(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin;

  // Check if origin is allowed
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    // Same-origin requests (no Origin header) are allowed
    // This handles requests from the same domain
    const host = req.headers.host;
    if (host) {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      res.setHeader('Access-Control-Allow-Origin', `${protocol}://${host}`);
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}
