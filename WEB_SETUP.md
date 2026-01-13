# Docker Image Sync to Aliyun - Web Interface Setup Guide

This guide will walk you through setting up the web interface for syncing Docker images to Aliyun registry.

## Prerequisites

1. **Supabase Account** - Sign up at https://supabase.com
2. **GitHub Account** with this repository
3. **Vercel Account** - Sign up at https://vercel.com (free tier is sufficient)
4. **Aliyun Container Registry** - Already configured with credentials in repository secrets

## Step 1: Set Up Supabase

### 1.1 Create a new Supabase project

1. Go to https://app.supabase.com
2. Click "New project"
3. Fill in:
   - Name: `docker-image-sync` (or any name)
   - Database Password: (generate a strong password)
   - Region: Choose closest to you
4. Click "Create new project" and wait for it to initialize

### 1.2 Create the database table

1. In your Supabase project, go to "SQL Editor"
2. Click "New query"
3. Paste the following SQL:

```sql
-- Create sync_jobs table
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),

  -- Job details
  workflow_type VARCHAR(10) NOT NULL,
  source_registry VARCHAR(255) DEFAULT 'docker.io',
  source_repo VARCHAR(255) NOT NULL,
  destination_registry VARCHAR(255) NOT NULL,
  destination_repo VARCHAR(255) NOT NULL,

  -- GitHub Action details
  github_run_id VARCHAR(50),
  github_run_number INTEGER,

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  conclusion VARCHAR(20),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Additional info
  error_message TEXT,
  logs_url TEXT
);

-- Create indexes
CREATE INDEX idx_sync_jobs_user_id ON sync_jobs(user_id);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX idx_sync_jobs_created_at ON sync_jobs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only see their own jobs
CREATE POLICY "Users can view their own sync jobs"
  ON sync_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sync jobs"
  ON sync_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sync jobs"
  ON sync_jobs
  FOR UPDATE
  USING (auth.uid() = user_id);
```

4. Click "Run" to execute the SQL

### 1.3 Create a user account

1. Go to "Authentication" → "Users"
2. Click "Add user" → "Create new user"
3. Fill in:
   - Email: your email address
   - Password: create a password (you'll use this to login to the web app)
   - Auto Confirm User: **Enable this**
4. Click "Create user"

### 1.4 Get your Supabase credentials

1. Go to "Settings" → "API"
2. Copy these values (you'll need them for Vercel):
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (click "Reveal" to see it)

## Step 2: Create GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token" → "Generate new token (classic)"
3. Fill in:
   - Note: `Docker Image Sync Web App`
   - Expiration: Choose your preference
   - Scopes: Select:
     - ✅ `repo` (Full control of private repositories)
     - ✅ `workflow` (Update GitHub Action workflows)
4. Click "Generate token"
5. **Copy the token** (you won't be able to see it again!)

## Step 3: Deploy to Vercel

### 3.1 Install Vercel CLI (Optional)

```bash
npm install -g vercel
```

### 3.2 Deploy via Vercel Dashboard (Recommended)

1. Go to https://vercel.com
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Configure:
   - Framework Preset: **Other**
   - Root Directory: `./` (leave as default)
   - Build Command: Leave empty
   - Output Directory: Leave empty
5. Click "Deploy"

### 3.3 Add Environment Variables

After deployment, go to your project settings:

1. Go to "Settings" → "Environment Variables"
2. Add the following variables:

| Name | Value | Source |
|------|-------|--------|
| `GITHUB_TOKEN` | `ghp_xxxxx...` | Your GitHub Personal Access Token from Step 2 |
| `GITHUB_REPOSITORY` | `your-username/sync-docker-image` | Your GitHub repository (format: `owner/repo`) |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | From Supabase Step 1.4 |
| `SUPABASE_ANON_KEY` | `eyJxxxxx...` | anon public key from Supabase Step 1.4 |
| `SUPABASE_SERVICE_KEY` | `eyJxxxxx...` | service_role key from Supabase Step 1.4 |

3. Click "Save" for each variable

### 3.4 Redeploy

1. Go to "Deployments"
2. Click the three dots on the latest deployment
3. Click "Redeploy"
4. Check "Use existing Build Cache" is OFF
5. Click "Redeploy"

## Step 4: Test the Application

### 4.1 Access the Web App

1. Go to your Vercel deployment URL (e.g., `https://your-app.vercel.app`)
2. You should see the login page
3. Login with the email and password you created in Supabase (Step 1.3)

### 4.2 Create a Test Sync Job

1. After login, you'll see the main page
2. Fill in the form:
   - Source Image: `nginx:1.27`
   - Destination Image: `registry.cn-shenzhen.aliyuncs.com/your-namespace/nginx:1.27`
   - Sync Type: Copy (single tag)
3. Click "Start Sync"

### 4.3 Verify

1. Check the jobs list on the page - you should see your job with status "running"
2. Go to your GitHub repository → Actions tab
3. You should see a new workflow run
4. The page will auto-refresh every 10 seconds to update the status
5. When complete, you can click the copy button to copy the Aliyun image URL

## Alternative: Deploy with Vercel CLI

If you prefer using the CLI:

```bash
# Login to Vercel
vercel login

# Set environment variables
vercel env add GITHUB_TOKEN
vercel env add GITHUB_REPOSITORY
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_KEY

# Deploy
vercel --prod
```

## Troubleshooting

### Issue: "Missing Supabase environment variables"

- Check that all environment variables are set in Vercel
- Make sure you redeployed after adding the variables

### Issue: "Failed to trigger GitHub workflow"

- Verify your GitHub token has `repo` and `workflow` scopes
- Check that `GITHUB_REPOSITORY` is in the correct format (`owner/repo`)
- Ensure the GitHub token hasn't expired

### Issue: Login fails

- Verify the user exists in Supabase Authentication
- Check that "Auto Confirm User" was enabled when creating the user
- Try resetting the password in Supabase dashboard

### Issue: Jobs not showing up

- Check browser console for errors
- Verify the Supabase table was created correctly
- Check Row Level Security policies in Supabase

## Database Schema Reference

The `sync_jobs` table stores all sync job information:

- `id` - Unique job identifier
- `user_id` - User who created the job
- `workflow_type` - Either "copy" or "sync"
- `source_registry` - Source registry URL
- `source_repo` - Source repository and tag
- `destination_registry` - Aliyun registry URL
- `destination_repo` - Destination repository and tag
- `github_run_id` - GitHub Actions run ID
- `status` - Job status: pending, running, success, or failed
- `created_at` - When the job was created
- `logs_url` - Link to GitHub Actions logs

## Security Notes

- The `SUPABASE_SERVICE_KEY` should be kept secret and only used in server-side code
- Row Level Security ensures users can only see their own sync jobs
- GitHub token should have minimal required permissions
- Consider setting up GitHub webhook for real-time status updates (advanced)

## Next Steps

- Set up GitHub webhooks for real-time status updates
- Add email notifications when sync jobs complete
- Implement job history cleanup for old jobs
- Add support for batch syncing multiple images
