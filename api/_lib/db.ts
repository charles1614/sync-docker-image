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
    options?: { status?: string; limit?: number; offset?: number; search?: string }
  ): Promise<{ jobs: SyncJob[]; total: number }> {
    let query = supabase
      .from('sync_jobs')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Status filter
    if (options?.status) {
      query = query.eq('status', options.status);
    }

    // Search filter - search in source_repo field
    if (options?.search) {
      query = query.ilike('source_repo', `%${options.search}%`);
    }

    // Ordering
    query = query.order('created_at', { ascending: false });

    // Pagination
    if (options?.offset !== undefined) {
      const limit = options?.limit || 10;
      query = query.range(
        options.offset,
        options.offset + limit - 1
      );
    } else if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    return { jobs: data || [], total: count || 0 };
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

  // Delete older successful jobs with the same source_repo
  async deleteOlderSuccessfulJobs(
    userId: string,
    sourceRepo: string,
    currentJobId: string
  ): Promise<number> {
    // Delete all older successful jobs with the same source_repo
    // except the current job
    const { data, error } = await supabase
      .from('sync_jobs')
      .delete()
      .eq('user_id', userId)
      .eq('source_repo', sourceRepo)
      .eq('status', 'success')
      .neq('id', currentJobId)
      .select();

    if (error) {
      console.error('Failed to cleanup old jobs:', error);
      throw error;
    }

    return data?.length || 0;
  },

  // Delete a single sync job
  async deleteSyncJob(id: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('sync_jobs')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to delete job:', error);
      throw error;
    }

    return true;
  },
};
