# macOS 常驻部署

DeliveryHub 管理服务可以通过 system launchd 在 macOS 上常驻运行，TeamCity 和构建 Agent 继续在原来的远程主机执行测试、构建及镜像推送。本配置不增加融合平台的自动部署步骤。原有 Docker Compose 入口继续保留。

## 服务与目录

需要 Node.js 22 及以上（本次实测 Node 24）、锁定版本的 pnpm、Python 3，以及 Homebrew 的 `postgresql@16`、`redis`、`nginx`。启动脚本当前使用 Apple Silicon Homebrew 路径 `/opt/homebrew` 和 Node 路径 `/usr/local/bin/node`，其他安装位置应先适配脚本。

示例服务根目录为 `/Users/m2/services/deliveryhub`：

| 目录                            | 用途                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `releases/<version>`、`current` | 独立源码、依赖和构建产物，以及当前版本符号链接                |
| `config/runtime.env`            | 原有密钥及目标地址，权限 0600；当前源码的 `.env` 链接到此文件 |
| `data/postgres`、`data/redis`   | 独立持久化目录，权限 0700                                     |
| `backups`                       | 数据检查点、校验清单及修改前的主机配置                        |
| `launchd`、`logs`、`run`        | 六个启动定义、运行日志和临时文件                              |

| system launchd 标签        | 进程与入口                                           |
| -------------------------- | ---------------------------------------------------- |
| `com.deliveryhub.postgres` | PostgreSQL，`127.0.0.1:15432`                        |
| `com.deliveryhub.redis`    | Redis，`127.0.0.1:16379`，启用 AOF                   |
| `com.deliveryhub.api`      | API，端口 3000                                       |
| `com.deliveryhub.worker`   | 配置任务 Worker                                      |
| `com.deliveryhub.web`      | 独立 Nginx，端口 8080，静态页面及 `/api/` 代理       |
| `com.deliveryhub.callback` | SSH 反向隧道，将 TeamCity 主机的回环端口转到当前 API |

plist 中使用 `UserName=m2`，业务进程不以 root 运行。安装到 `/Library/LaunchDaemons` 后由 system launchd 在系统启动时加载，不依赖图形界面登录。`KeepAlive` 负责进程退出后的重启；依赖服务的启动顺序由入口脚本的就绪等待处理。不要将这些定义同时安装成 LaunchAgents 或 Homebrew services，以免重复进程争用数据目录。

## 构建与配置

在独立 release 目录安装锁定依赖并执行 `pnpm db:generate`，再用 `VITE_API_BASE_URL='' pnpm build` 构建。空 API 基地址使浏览器通过当前站点的 `/api/` 代理请求，避免把访问者自己的 localhost 编译进生产页面。不要把另一架构的 `node_modules` 直接复制过来。迁移既有安装时必须保留数据库对应的 `APP_SECRET_KEY` 和 `CREDENTIAL_ENCRYPTION_KEY` 检查点，不要执行首次初始化种子来覆盖现有账号。如果原开发密钥无法通过生产校验，先在恢复后的迁移副本中通过 `deploy/macos/rotate-credentials.cjs <旧加密密钥文件>` 事务重加密：该工具使用编译后的原有加密实现、逐条确认明文等价，并保留所有业务元数据；失败会整体回滚。旧密钥文件权限必须为 0600，目标密钥通过受限环境注入。轮换 `APP_SECRET_KEY` 还需要同步更新 DeliveryHub 管理的 TeamCity 回调令牌，并让用户重新登录；不能只换环境变量而保留旧密文或旧回调令牌。

`runtime.env` 为 shell 可读取的赋值文件；含特殊字符的值必须正确引用。除项目已有环境变量外，启动入口还需要：

```sh
PG_BIN=/opt/homebrew/opt/postgresql@16/bin
WORKER_API_BASE_URL=http://127.0.0.1:3000
CALLBACK_SSH_ALIAS=236-130
CALLBACK_REMOTE_PORT=33030
```

回调地址应与 TeamCity 实际参数一致，例如 `PUBLIC_CALLBACK_BASE_URL=http://127.0.0.1:33030`。该回环地址属于 TeamCity 宿主机，由 SSH 隧道转发到新的 DeliveryHub；不能仅把本机地址原样保留却不迁移隧道。SSH 别名、私钥及可信主机记录应按实际引用迁移，保留目标主机原有配置，并先实测无交互登录。

准备 `current` 链接后运行：

```sh
python3 current/deploy/macos/prepare.py --root /Users/m2/services/deliveryhub --user m2
```

生成器只写独立的 Nginx、Redis 和 launchd 配置，不恢复数据库、不注册服务、不修改系统电源配置。确认目标端口可用、数据库初始化和检查点恢复完成后，再以管理员权限把生成的 plist 安装到 `/Library/LaunchDaemons`（root:wheel，0644），通过 `launchctl bootstrap system <plist>` 加载。整个数据目录仍归服务账号所有。

## 数据迁移与切换

1. 盘点完整数据库、队列、应用密钥、SSH 配置和构建回调路径。使用 `pg_dump -Fc` 和 Redis 引擎 RDB 快照；运行中的数据目录不能直接文件复制。
2. 为备份记录时间、字节数、SHA-256、各表行数及稳定行内容指纹。传输后重新计算文件校验值，确认 `pg_restore --list` 可读取备份。
3. 保留源码和目标配置后，先启动独立 PostgreSQL 与 Redis，恢复同一检查点。比较所有表的行数及内容指纹（查询统一使用 UTC 时区及同样的行分隔符），并确认队列没有进行中的配置任务。Redis 从 RDB 恢复时先以 `appendonly no` 加载快照，核对任务数据后再执行 `CONFIG SET appendonly yes`、`CONFIG REWRITE` 并等待 AOF 重写完成；直接在空 AOF 模式下启动可能不读取 RDB。停止旧 Redis 后要等待其进程真正退出，再复制快照，避免关闭时的最后一次保存覆盖恢复文件。
4. 最终切换前停止源端 DeliveryHub 的 API、Worker 和回调隧道，验证没有源端后台写入，再取得最终检查点。源数据库保留，设置只读作为防止误启动写入的附加措施；目标必须恢复最终检查点并对齐后才能启用应用。
5. 启动目标 API、Worker、Web 和回调隧道。通过用户实际访问入口登录，测试远程集成、结果同步、历史构建、镜像及部署边界。恢复后的管理员密码保持原值。
6. 验证 launchd 的 system 注册、运行账号和进程退出后重启。若未执行整机重启，交接时明确没有实测物理重启；共享机器不能为了证明启动项而随意中断其他服务。

## 验收与回退

验收至少覆盖：真实页面及静态资源、管理员登录、受权 API、所有表迁移一致性、原凭据的外部连接、TeamCity 结果同步、最新五个组件镜像为 `AVAILABLE`、回调隧道、system launchd 注册和进程恢复。数据库与 Redis 只绑定回环地址，同时检查原有服务入口仍可用。

切换失败时先停止目标 API、Worker 与隧道，阻止两边同时写入。目标尚未产生新写入时可恢复源检查点和原服务；目标已经产生新记录时，必须先导出目标数据库与 Redis、校验并回灌源端，再解除源数据库只读、恢复源进程及隧道。旧检查点不能代替切换后新增记录的恢复，本方案不宣称仅切回旧目录即可无损回退。本次源端 Redis 7、目标 Redis 8：回灌前必须使用兼容目标快照的 Redis 版本，不能直接把 Redis 8 的 RDB 覆盖进 Redis 7；源应用环境也必须使用与目标新密文匹配的随机密钥。反向恢复需要单独验证后才能解除源端写入隔离。

保留源数据库、备份、原 SSH 配置和电源设置；不自动删除旧数据，不对融合平台执行部署或数据库迁移。
