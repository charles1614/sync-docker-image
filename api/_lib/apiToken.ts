import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { supabase } from './db.js';
import type { ApiToken, ApiTokenPublic } from './types.js';

// Tokens look like: sdi_<43 base64url chars> (32 bytes of entropy)
export const TOKEN_PREFIX = 'sdi_';
const TOKEN_PATTERN = /^sdi_[A-Za-z0-9_-]{20,128}$/;

export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

// SHA-256 is appropriate here: the token is 256 bits of CSPRNG output, so it is
// not brute-forceable and does not need a slow password hash.
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    // Shown in the UI/CLI so a token can be identified without revealing it
    prefix: token.slice(0, TOKEN_PREFIX.length + 8),
  };
}

export function toPublicToken(row: ApiToken): ApiTokenPublic {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at ?? null,
    expires_at: row.expires_at ?? null,
    revoked_at: row.revoked_at ?? null,
  };
}

export interface VerifiedToken {
  user_id: string;
  token_id: string;
}

// Look up a plaintext API token and return its owner, or null if it is
// unknown, revoked or expired.
export async function verifyApiToken(token: string): Promise<VerifiedToken | null> {
  if (!TOKEN_PATTERN.test(token)) {
    return null;
  }

  const hash = hashToken(token);

  const { data, error } = await supabase
    .from('api_tokens')
    .select('*')
    .eq('token_hash', hash)
    .maybeSingle();

  if (error) {
    console.error('Failed to look up API token:', error);
    return null;
  }

  if (!data) return null;

  const row = data as ApiToken;

  // Constant-time compare as a belt-and-braces check against any future
  // change that might make the lookup non-exact.
  const expected = Buffer.from(row.token_hash, 'utf8');
  const actual = Buffer.from(hash, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  // Throttle last_used_at writes to at most one per minute per token
  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    const { error: touchError } = await supabase
      .from('api_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id);

    if (touchError) {
      // Never fail the request just because we could not record usage
      console.error('Failed to update token last_used_at:', touchError);
    }
  }

  return { user_id: row.user_id, token_id: row.id };
}

export const tokenDb = {
  async list(userId: string): Promise<ApiTokenPublic[]> {
    const { data, error } = await supabase
      .from('api_tokens')
      .select('*')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(toPublicToken);
  },

  async countActive(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('api_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (error) throw error;
    return count || 0;
  },

  async create(
    userId: string,
    name: string,
    expiresAt: string | null
  ): Promise<{ token: string; record: ApiTokenPublic }> {
    const { token, hash, prefix } = generateToken();

    const { data, error } = await supabase
      .from('api_tokens')
      .insert({
        user_id: userId,
        name,
        token_prefix: prefix,
        token_hash: hash,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    return { token, record: toPublicToken(data as ApiToken) };
  },

  // Soft delete so a leaked token can never be resurrected by re-inserting the hash
  async revoke(id: string, userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select();

    if (error) throw error;
    return (data?.length || 0) > 0;
  },
};
