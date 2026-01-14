## 同步DockerHub上的镜像仓库到阿里云容器镜像仓库

Docker 的一些服务所在域名被封杀，无法直接访问和拉取镜像。国内的镜像源又宣布停止服务，所以需要一个工具将DockerHub上的镜像同步到阿里云容器镜像仓库。

阿里云容器镜像仓库提供了个人实例服务，支持最多创建300个仓库，而且免费。个人使用完全够满足需求。

阿里云容器镜像仓库地址： [https://cr.console.aliyun.com/](https://cr.console.aliyun.com/)

## 🌐 全新 Web 界面！

现在支持通过 **Web 界面** 管理和触发镜像同步！

- ✅ 简单的网页表单，输入镜像名称即可同步
- ✅ 实时查看同步任务状态
- ✅ 自动更新任务进度
- ✅ 一键复制同步后的阿里云镜像地址
- ✅ 支持私有访问控制
- ✅ 包含安全性增强：CORS 保护、速率限制、输入验证

部署到 Vercel，配置 Supabase 数据库，即可开始使用！

### Web 界面设置教程

#### 前置要求

1. **Supabase 账号** - 在 https://supabase.com 注册
2. **GitHub 账号**
3. **Vercel 账号** - 在 https://vercel.com 注册 (免费版即可)
4. **阿里云容器镜像仓库** - 已在仓库 Secrets 中配置好凭证

#### 步骤 1: 设置 Supabase

##### 1.1 创建 Supabase 项目

1. 访问 https://app.supabase.com
2. 点击 "New project"
3. 填写信息：
   - Name: `docker-image-sync` (或任意名称)
   - Database Password: (生成强密码)
   - Region: 选择离你最近的区域
4. 点击 "Create new project" 并等待初始化

##### 1.2 创建数据库表

1. 在 Supabase 项目中，进入 "SQL Editor"
2. 点击 "New query"
3. 粘贴以下 SQL：

```sql
-- 创建 sync_jobs 表
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),

  -- 任务详情
  workflow_type VARCHAR(10) NOT NULL,
  source_registry VARCHAR(255) DEFAULT 'docker.io',
  source_repo VARCHAR(255) NOT NULL,
  destination_registry VARCHAR(255) NOT NULL,
  destination_repo VARCHAR(255) NOT NULL,

  -- GitHub Action 详情
  github_run_id VARCHAR(50),
  github_run_number INTEGER,

  -- 状态跟踪
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  conclusion VARCHAR(20),

  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- 附加信息
  error_message TEXT,
  logs_url TEXT
);

-- 创建索引
CREATE INDEX idx_sync_jobs_user_id ON sync_jobs(user_id);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX idx_sync_jobs_created_at ON sync_jobs(created_at DESC);

-- 启用行级安全
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- 创建策略：用户只能看到自己的任务
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

4. 点击 "Run" 执行 SQL

##### 1.3 创建用户账号

1. 进入 "Authentication" → "Users"
2. 点击 "Add user" → "Create new user"
3. 填写信息：
   - Email: 你的邮箱地址
   - Password: 创建密码 (用于登录 Web 应用)
   - Auto Confirm User: **启用此选项**
4. 点击 "Create user"

##### 1.4 获取 Supabase 凭证

1. 进入 "Settings" → "API"
2. 复制以下值 (Vercel 部署时需要)：
   - **Project URL** (例如：`https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (点击 "Reveal" 查看)

#### 步骤 2: 创建 GitHub Personal Access Token

1. 访问 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 填写信息：
   - Note: `Docker Image Sync Web App`
   - Expiration: 选择你需要的过期时间
   - Scopes: 选择：
     - ✅ `repo` (完全控制私有仓库)
     - ✅ `workflow` (更新 GitHub Action workflows)
4. 点击 "Generate token"
5. **复制 token** (你以后无法再看到它！)

#### 步骤 3: 部署到 Vercel

##### 3.1 通过 Vercel Dashboard 部署 (推荐)

1. 访问 https://vercel.com
2. 点击 "Add New" → "Project"
3. 导入你的 GitHub 仓库
4. 配置：
   - Framework Preset: **Other**
   - Root Directory: `./` (保持默认)
   - Build Command: 留空
   - Output Directory: 留空
5. 点击 "Deploy"

##### 3.2 添加环境变量

部署完成后，进入项目设置：

1. 进入 "Settings" → "Environment Variables"
2. 添加以下变量：

| 变量名 | 值 | 来源 |
|------|-------|--------|
| `GITHUB_TOKEN` | `ghp_xxxxx...` | 步骤 2 的 GitHub Personal Access Token |
| `GITHUB_REPOSITORY` | `your-username/sync-docker-image` | 你的 GitHub 仓库 (格式: `owner/repo`) |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | 步骤 1.4 的 Supabase URL |
| `SUPABASE_ANON_KEY` | `eyJxxxxx...` | 步骤 1.4 的 anon public key |
| `SUPABASE_SERVICE_KEY` | `eyJxxxxx...` | 步骤 1.4 的 service_role key |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` | 你的 Vercel 部署域名 (用逗号分隔多个域名) |

3. 为每个变量点击 "Save"

**重要：** `ALLOWED_ORIGINS` 是安全功能的一部分，只允许指定的域名访问 API。请将其设置为你的实际部署域名。例如：
- 单个域名：`https://your-app.vercel.app`
- 多个域名：`https://your-app.vercel.app,https://custom-domain.com`

##### 3.3 重新部署

1. 进入 "Deployments"
2. 点击最新部署的三个点
3. 点击 "Redeploy"
4. 确保 "Use existing Build Cache" 关闭
5. 点击 "Redeploy"

#### 步骤 4: 测试应用

##### 4.1 访问 Web 应用

1. 访问你的 Vercel 部署 URL (例如：`https://your-app.vercel.app`)
2. 你应该看到登录页面
3. 使用在 Supabase 中创建的邮箱和密码登录 (步骤 1.3)

##### 4.2 创建测试同步任务

1. 登录后，你会看到主页面
2. 填写表单：
   - Source Image: `nginx:1.27`
   - Destination Image: `registry.cn-shenzhen.aliyuncs.com/your-namespace/nginx:1.27`
   - Sync Type: Copy (single tag)
3. 点击 "Start Sync"

##### 4.3 验证

1. 检查页面上的任务列表 - 你应该看到状态为 "running" 的任务
2. 访问你的 GitHub 仓库 → Actions 标签
3. 你应该看到新的 workflow 运行
4. 页面每 10 秒自动刷新以更新状态
5. 完成后，你可以点击复制按钮来复制阿里云镜像 URL

#### 安全性说明

本项目包含以下安全增强：

- **CORS 保护**: 只允许配置的域名访问 API (通过 `ALLOWED_ORIGINS`)
- **速率限制**: 防止暴力攻击 (登录: 15分钟5次，创建任务: 1分钟10次)
- **输入验证**: 严格验证 Docker 镜像 URL 格式
- **授权检查**: 用户只能访问和修改自己的任务
- **安全头**: X-Frame-Options, CSP 等
- **行级安全**: Supabase RLS 确保数据隔离

#### 故障排除

**问题: "Missing Supabase environment variables"**
- 检查所有环境变量是否在 Vercel 中设置
- 确保添加变量后重新部署

**问题: "Failed to trigger GitHub workflow"**
- 验证你的 GitHub token 具有 `repo` 和 `workflow` 权限
- 检查 `GITHUB_REPOSITORY` 格式是否正确 (`owner/repo`)
- 确保 GitHub token 没有过期

**问题: 登录失败**
- 验证用户在 Supabase Authentication 中存在
- 检查创建用户时是否启用了 "Auto Confirm User"
- 尝试在 Supabase dashboard 中重置密码

**问题: CORS 错误**
- 确保 `ALLOWED_ORIGINS` 环境变量包含你访问应用的域名
- 检查浏览器控制台的具体错误信息
- 验证域名格式正确 (包含 `https://`)

**问题: 速率限制错误 (429)**
- 等待限制重置 (登录: 15分钟，API: 1分钟)
- 检查是否有意外的重复请求

---

支持用命令行触发workflow运行，[点此查看方法](#使用命令行直接同步镜像)

## Copy.yml 运行介绍

这个工具主要是将 DockerHub 上某个仓库下的某个标签同步到阿里云容器镜像仓库。

1. 使用阿里云开通个人实例服务，并获取 [登录用户名和固定密码](https://cr.console.aliyun.com/cn-hangzhou/instance/credentials)

2. 克隆本仓库，在仓库设置中配置阿里云密码，注意 *Name* 必须为 `DESTINATION_CREDENTIAL` 且内容格式必须为 `<Username>:<Password>` 即用户名和密码之间用冒号分隔。

![配置密码页面](assets/settings-actions-secrets.png)

![配置内容](assets/new-secret.png)

3. 在 *Actions* 页面上选择 *copy.yml* 点击 *Run workflow* 填写内容即可运行。

![Run Copy workflow](assets/copy.png)

> 填写说明：
>
> 如同步 DockerHub 上的 nginx:1.13 到 阿里云容器镜像仓库 registry.cn-beijing.aliyuncs.com/ikrong/nginx:1.13，则填写如下：
>
> ```yaml
> # 镜像源 (Registry)
> source: docker.io
> # 目标源 (Registry)
> destination: registry.cn-beijing.aliyuncs.com
> # 仓库及标签 (格式 repo:tag)
> source_repo: nginx:1.13
> # 目标仓库及标签 (格式 repo:tag)
> destination_repo: ikrong/nginx:1.13
> ```
> 必须要填写仓库及标签

## Sync.yml 运行介绍

这个工具主要是将 DockerHub 上某个仓库下的所有标签全部同步到阿里云容器镜像仓库。

1. 配置密码同上

2. 在 *Actions* 页面上选择 *sync.yml* 点击 *Run workflow* 填写内容即可运行。

![RUN Sync workflow](assets/sync.png)

> 填写说明：
>
> 如同步 DockerHub 上的 nginx 的所有标签到阿里云容器镜像仓库 registry.cn-beijing.aliyuncs.com/ikrong/nginx，则填写如下：
>
> ```yaml
> # 镜像源 (Registry)
> source: docker.io
> # 目标源 (Registry)
> destination: registry.cn-beijing.aliyuncs.com
> # 仓库 (格式 repo)
> source_repo: nginx
> # 目标Scope (格式 scope)
> destination_scope: ikrong
> ```
> 只需要填写需要同步的仓库和目标仓库所在的scope


## 使用命令行直接同步镜像

现在提供脚本 ```exec.sh``` 可以在linux或者macos上运行，下面介绍运行方法：

1. 命令行上基于 [github-cli](https://github.com/cli/cli) 实现的，所以需要先安装 github-cli 工具

```shell
# 快速安装方法
curl -sS https://webi.sh/gh | sh
# 或者可以查看 github-cli 文档自己下载安装
# https://github.com/cli/cli?#installation
```

2. 安装 github-cli 后需要登陆

```shell
# 登陆命令
gh auth login
```

3. fork本仓库，并且按照 [上面copy.yml中密码相关配置](#copyyml-运行介绍) 进行配置

4. 使用git clone你fork后的仓库，然后开始执行根目录下的 exec.sh 文件，注意文件的执行权限

5. 命令行运行 copy.yml workflow

以将 nginx:1.13 复制到 registry.cn-beijing.aliyuncs.com/ikrong/nginx:1.13 仓库为例

```shell
# 命令行如下：
./exec.sh trigger -w copy.yml destination=registry.cn-beijing.aliyuncs.com source_repo=nginx:1.13 destination_repo=ikrong/nginx:1.13
# 可以省略等号前面的，但是顺序不能变
./exec.sh trigger -w copy.yml registry.cn-beijing.aliyuncs.com nginx:1.13 ikrong/nginx:1.13
# 由于脚本默认 registry.cn-beijing.aliyuncs.com ，所以这个也可以省略
./exec.sh trigger -w copy.yml nginx:1.13 ikrong/nginx:1.13
# 另外 trigger -w copy.yml 可以简写为 copy，所以命令可以改为
./exec.sh copy nginx:1.13 ikrong/nginx:1.13

# 查看运行状态，不过上面的 trigger 命令执行时会自动输出 status，下面的命令一般不需要执行
./exec.sh status -w copy.yml
```

6. 命令行运行 sync.yml workflow

以将 nginx 同步到 registry.cn-beijing.aliyuncs.com/ikrong/nginx 仓库为例

```shell
# 命令行如下
./exec.sh trigger -w sync.yml destination=registry.cn-beijing.aliyuncs.com source_repo=nginx destination_scope=ikrong
# 仍然可以省略等号前面的
./exec.sh trigger -w sync.yml nginx ikrong
# 另外 trigger -w sync.yml 可以简写为 sync，所以命令可以改为
./exec.sh sync nginx ikrong
```

7. 推荐使用命令

```shell
# 如果想要复制1个标签，如 nginx:1.13 到 registry.cn-beijing.aliyuncs.com/ikrong/nginx:1.13
# 则可以使用命令
./exec.sh copy nginx:1.13 ikrong/nginx:1.13

# 如果想要同步某个仓库，如 nginx 到 registry.cn-beijing.aliyuncs.com/ikrong/nginx 仓库
# 则可以使用命令
./exec.sh sync nginx ikrong
```

8. 为了减少记忆负担，再次简化 copy 和 sync 命令

执行 copy 和 sync 命令时，可以将 registry/scope/repo:tag 写在一起，更符合常见的用法

不过，由于 sync 命令特殊，源仓库的 tag 和目标仓库的 repo:tag 将会被忽略掉

同时，增加 ./copy.sh 和 ./sync.sh 两个脚本，内部调用 ./exec.sh

```shell
# 想要复制某个镜像标签，可以直接这样执行命令
./exec.sh copy ghcr.io/nginx:1.13 registry.cn-hangzhou.aliyuncs.com/ikrong/nginx:1.13
./exec.sh copy nginx:1.13 registry.cn-hangzhou.aliyuncs.com/ikrong/nginx:1.13
# 想要同步某个仓库，可以直接这样执行命令
./exec.sh sync ghcr.io/nginx registry.cn-hangzhou.aliyuncs.com/ikrong
./exec.sh sync ghcr.io/nginx:1.13 registry.cn-hangzhou.aliyuncs.com/ikrong/nginx:1.13 
# 指定标签和上面不指定标签无任何区别，脚本会忽略掉后面的标签

# 使用 ./copy.sh 和 ./sync.sh 命令
./copy.sh ghcr.io/nginx:1.13 registry.cn-hangzhou.aliyuncs.com/ikrong/nginx:1.13
./sync.sh nginx registry.cn-hangzhou.aliyuncs.com/ikrong
```

9. 当使用copy时，可以指定参数 --pull 就可以在 workflow 执行完毕后，自动拉取镜像

```shell
./copy.sh nginx:1.14 ikrong/nginx:1.14 --pull
```

10. 脚本默认会有确认提示，使用参数 -y 可以跳过确认执行

```shell
./copy.sh nginx:1.14 ikrong/nginx:1.14 -y
./sync.sh nginx ikrong -y
```

## 镜像同步之后如何使用

当使用上面办法将镜像同步到阿里云容器镜像仓库后，就可以直接使用阿里云容器镜像仓库的镜像了。

以 `nginx:1.13` 为例:

1. 使用命令拉取 

```sh
docker pull registry.cn-beijing.aliyuncs.com/ikrong/nginx:1.13
```

2. 在 `Dockerfile` 中使用：

```dockerfile
FROM registry.cn-beijing.aliyuncs.com/ikrong/nginx:1.13

# 其他内容
```
