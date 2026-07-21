# Delivery Hub

Delivery Hub 是面向研发团队的 GitLab、TeamCity 与腾讯云 TCR CI/CD 编排平台。它以模块化单体方式集中管理项目接入、CI 配置、构建、镜像、服务器和 Docker Compose 部署。

## 已实现能力

- GitLab、TeamCity 和 Registry 连接管理、加密凭证与连接测试。
- GitLab 项目同步、搜索、分组、分支和 Dockerfile/技术特征扫描。
- 多 Dockerfile 组件配置，同一 TeamCity 组下创建多个独立项目。
- TeamCity Project、VCS Root、Build Configuration、参数、构建步骤和 VCS Trigger 幂等创建及编辑。
- BullMQ 后台 Provisioning、进度查询、自动重试和失败任务重试。
- 手动触发构建、TeamCity 状态轮询、构建回调、构建记录和镜像版本记录。
- SHA、Build Number、分支和 latest 多标签推送，记录镜像 Digest。
- SSH Config 服务器发现、连通性检查和部署目录管理。
- Docker Compose 文件读取、校验、镜像替换、部署执行和部署记录。
- 应用列表、组件信息、TeamCity 资源存在性检查和动态工作台。

当前不包含 Kubernetes；Server Agent 仍为后续能力。

## 环境要求

- Node.js 22 或 24
- pnpm 10
- Docker Desktop / Docker Compose
- PostgreSQL 16、Redis 7
- 可访问的 GitLab、TeamCity 和腾讯云 TCR
- 至少一个在线且安装 Docker/curl 的 TeamCity Agent

## 本地开发

一键启动：

```bash
./start.sh
```

脚本会自动安装缺失的依赖、启动 PostgreSQL 和 Redis、执行数据库迁移与种子初始化，并启动 Web、API 和 Worker。默认端口被占用时，脚本会自动选择后续可用端口。

首次运行时，脚本会从 `.env.example` 创建权限为 `0600` 的 `.env`，并自动生成本地数据库密码、应用密钥、凭证加密密钥和管理员密码。已有 `.env` 不会被覆盖。

也可以手动执行：

```bash
cp .env.example .env
# 替换文件中的所有 CHANGE_ME 值，生成方式见下文“生产部署”。
pnpm install
pnpm db:generate
docker compose --env-file .env -f deploy/docker-compose.yml up -d postgres redis
pnpm db:deploy
pnpm db:seed
pnpm dev
```

本地地址：

- Web：`http://localhost:5173`
- API：`http://localhost:3000`
- Swagger：`http://localhost:3000/api/docs`

默认账号仅在开发构建中自动填入登录页面；生产构建不会显示默认账号密码。

## 生产部署

不要直接使用 `.env.example` 中的占位值。可使用以下命令生成独立密钥：

```bash
openssl rand -hex 32     # APP_SECRET_KEY
openssl rand -base64 32  # CREDENTIAL_ENCRYPTION_KEY
openssl rand -hex 24     # PostgreSQL password
openssl rand -base64 24  # INITIAL_ADMIN_PASSWORD
```

生产启动会拒绝公开占位符、低多样性密钥和默认管理员密码。`CREDENTIAL_ENCRYPTION_KEY` 用于解密数据库中的凭证，必须与数据库备份分开保存；丢失后已保存凭证无法恢复。

生产环境应使用 [deploy/production](deploy/production/README.md) 中的 Compose 配置，并在外部反向代理上启用 HTTPS。不要将开发 Compose 暴露到公网，因为它会映射 PostgreSQL 和 Redis 的宿主机端口。

## 关键环境变量

- `APP_SECRET_KEY`：JWT、Worker 内部令牌和 TeamCity 回调令牌的根密钥，至少 32 个字符。
- `CREDENTIAL_ENCRYPTION_KEY`：Base64 编码的 32 字节凭证加密密钥。
- `PUBLIC_CALLBACK_BASE_URL`：TeamCity Agent 能访问的 Delivery Hub API 公网或内网地址，不能使用 Agent 无法访问的 localhost。
- `DEFAULT_BUILD_STATUS_POLL_INTERVAL_SECONDS`：TeamCity 构建轮询间隔。
- `DEFAULT_SERVER_HEALTH_CHECK_INTERVAL_SECONDS`：部署目标 SSH 在线状态自动检测间隔。
- `BULLMQ_PREFIX`：Redis 队列前缀。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 文档

- [系统架构](docs/architecture.md)
- [部署说明](docs/deployment.md)
- [TeamCity 与 TCR 配置](docs/teamcity-tcr-setup.md)
- [运行和故障处理](docs/operations.md)

## 安全

不要在 Issue、Discussion、日志或截图中提交 Token、密码、私钥、数据库连接串或真实基础设施地址。漏洞请按照 [安全策略](SECURITY.md) 私下报告。

离线 Docker 镜像包不进入 Git 仓库；请通过 GitHub Releases、容器镜像仓库或受控对象存储分发。
