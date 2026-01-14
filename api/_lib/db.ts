import { createClient } from '@supabase/supabase-js';
import type { SyncJob } from './types.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

// Server-side client with service key for admin operations
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Client for user operations (with anon key)
export const createUserClient = (accessToken?: string) => {
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  const client = createClient(supabaseUrl, anonKey, {
    global: {
      headers: accessToken ? {
        Authorization: `Bearer ${accessToken}`,
      } : {},
    },
  });

  return client;
};

// Database operations
export const db = {
  // Create a new sync job
  async createSyncJob(job: Omit<SyncJob, 'id' | 'created_at'>): Promise<SyncJob> {
    const { data, error } = await supabase
      .from('sync_jobs')
      .insert(job)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get sync job by ID
  async getSyncJob(id: string, userId: string): Promise<SyncJob | null> {
    const { data, error } = await supabase
      .from('sync_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  },

  // List sync jobs for a user
  async listSyncJobs(
    userId: string,
    options?: { status?: string; limit?: number }
  ): Promise<SyncJob[]> {
    let query = supabase
      .from('sync_jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  },

  // Update sync job
  async updateSyncJob(
    id: string,
    userId: string,
    updates: Partial<SyncJob>
  ): Promise<SyncJob> {
    const { data, error } = await supabase
      .from('sync_jobs')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
