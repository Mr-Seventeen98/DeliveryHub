# Delivery Hub 运行和故障处理

## 进程边界

本地开发推荐只在 Docker 中运行 PostgreSQL 和 Redis，其他服务在本机运行：

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d postgres redis
pnpm dev
```

`pnpm dev` 同时启动 Web、API 和 Worker。Worker 未运行时，CI/CD 创建任务会停留在 Waiting 状态，但不会丢失；恢复 Worker 后任务会继续执行。

## 常见检查

```bash
curl http://localhost:3000/api/v1/health
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

页面入口：

- GitLab 项目：同步项目、添加或编辑 CI/CD。
- 应用接入：查看组件、配置项目部署目录、检查 TeamCity 资源、构建全部组件。
- 构建记录：同步状态、查看 TeamCity 日志、重新构建单个组件。
- 镜像版本：查看镜像地址、Commit、Build Number 和 Digest。
- 部署目标：自动读取 OpenSSH Config 别名，持续检测并展示在线或离线状态。
- 部署记录：查看镜像部署结果、目标服务器和远端 Compose 输出。

## 部署镜像到远程服务器

目标服务器需要安装 Docker 和 Docker Compose，并确保 SSH Config
配置的用户可以执行 Docker 命令。交付中心使用运行用户的
`~/.ssh/config`、`known_hosts` 和 SSH Agent，不在数据库中保存 SSH
密码或私钥。

1. 在系统中确认以下命令可以无交互连接：

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes <Host别名> \
  'printf DELIVERY_HUB_OK'
```

2. 打开“部署目标”，确认该 Host 别名已被自动发现并显示为在线；连接不可达时系统会自动切换为离线。
3. 在“应用接入”为项目配置部署目录：选择在线服务器，通过 SSH 浏览其目录，
   再选择包含 Compose 文件的路径。目录路径属于项目，部署时会在目标服务器上再次验证。
4. 在 Compose 服务中使用环境变量引用镜像：

```yaml
services:
  web:
    image: ${DELIVERY_IMAGE}
```

5. 在“镜像版本”选择平台已记录的版本，点击“部署”。
6. 选择在线目标、部署目录，填写 Compose 服务名 `web` 和镜像变量名 `DELIVERY_IMAGE`。

平台会通过 SSH 登录腾讯云镜像仓库，然后执行：

```bash
docker compose pull web
docker compose up -d --no-deps web
docker compose ps web
```

执行状态和远端输出保存在“部署记录”中。部署只重建所选服务，不会更新同一 Compose 项目中的其他服务。

以 systemd、launchd 等方式启动交付中心时，需要保证服务进程使用配置
SSH 的同一个系统用户，并保留正确的 `HOME` 和 `SSH_AUTH_SOCK` 环境变量。

## TeamCity 构建长期排队

在构建记录中检查队列诊断。常见原因：

- 没有在线且 Enabled 的 Agent。
- Agent 不兼容 Build Configuration。
- Agent 正在执行其他构建。
- Agent 未安装 Docker。

当前真实验收中 TeamCity 返回过：

```text
There are no idle compatible agents which can run this build
compatibleAgents: 0
```

这类问题需要在 TeamCity Agents 页面恢复或配置 Agent，不应重复点击触发构建。

## Provisioning 失败

创建任务默认自动尝试三次。失败后可调用：

```text
POST /api/v1/ci-configurations/jobs/<job-id>/retry
```

创建逻辑是幂等的，重试会复用已存在的 TeamCity 资源。页面通过任务状态接口显示进度：

```text
GET /api/v1/ci-configurations/jobs/<job-id>
```

## 配置检查

应用页的“检查配置”会逐个确认 TeamCity Project、VCS Root 和 Build Configuration 是否存在，并把资源标记为 Active 或 Missing。它不会自动删除或覆盖用户在 TeamCity 中的配置。
