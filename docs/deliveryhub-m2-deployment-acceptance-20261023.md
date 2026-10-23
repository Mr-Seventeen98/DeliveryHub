# DeliveryHub 部署至 192.168.1.13：迁移与验收记录

验收日期：2026-10-23。目标账号：`m2`。用户入口：<http://192.168.1.13:8080>，构建记录：<http://192.168.1.13:8080/builds>。使用原管理员账号及密码登录。

## 发布范围与运行位置

目标机为 Apple Silicon M2、macOS 26.4、8 GB 内存。使用 macOS 原生 Node 24 与 system launchd，代码目录为 `/Users/m2/services/deliveryhub/current`，实际 release 为 `releases/20261023-native`。原有 Docker Compose 和开发构建入口保持不变。

Web、API、Worker、PostgreSQL、Redis 和回调 SSH 隧道共六个服务均已安装至 `/Library/LaunchDaemons/com.deliveryhub.*.plist`。启动定义由 root 持有，业务进程均以 `m2` 运行。数据库与 Redis 分别仅绑定 `127.0.0.1:15432`、`127.0.0.1:16379`；Web 使用 8080，API 使用 3000。回调隧道只在 TeamCity 宿主机绑定 `127.0.0.1:33030`。

TeamCity 与 Linux 构建 Agent 保持原位置，融合平台的 main 提交触发和六个 CI 步骤保持有效，无自动部署步骤。此轮部署没有触发新的五组件构建，验收复用了已成功的 TeamCity #6（ID 3807）并实际回读 TCR。

## 数据检查点与唯一写入方

在目标基础设施准备完成后，仅停止源端 DeliveryHub 的 API/Worker 开发进程组、Web 进程及回调隧道；源端 PostgreSQL、Redis 与其他项目继续保留。源数据库 `delivery_hub` 已设置 `default_transaction_read_only=on`，并确认没有残留业务连接后取得最终检查点。目标成为本次迁移后的唯一 DeliveryHub 应用写入方。

最终检查点在本地受限目录 `.artifacts/deployment-m2-20261023/private/final/`，远端副本在 `/Users/m2/services/deliveryhub/backups/final-*`。备份内含敏感业务数据，目录权限为 0700，文件权限为 0600，不加入 Git。

| 对象                | 字节数 | SHA-256                                                            |
| ------------------- | -----: | ------------------------------------------------------------------ |
| PostgreSQL 逻辑备份 | 117414 | `906ce94f2d7fedcfa89f0661b99d2bd6eb1d40b1f086fa73a25eb4dd98fe65e3` |
| Redis 引擎快照      |  21642 | `70481c65ada5cb476c529a0ebb507834dadb8f55fdde5cacb3f3cb221fbf4b09` |

传输两端 SHA-256 一致，`pg_restore --list` 可读取，真实恢复后 20 张表的行数与行内容指纹全部匹配。指纹比较统一使用 UTC 时区。关键数据为：91 条构建记录、89 条镜像记录、8 条凭据、17 条配置任务、100 条仓库记录、20 条服务器记录、1 个用户。Redis 的 15 个键和 10 条已完成配置任务已恢复，没有进行中任务。

生产校验发现原开发环境的应用签名密钥、凭据加密密钥强度不足。因此保留原配置检查点，在目标副本中为 8 条凭据事务重加密，逐条校验明文等价，保留 ID 与业务元数据。随机目标密钥保存在受限配置文件；原管理员密码及外部凭据内容未修改。重复执行轮换检查为 `rotated=0`、`alreadyRotated=8`。DeliveryHub 管理的 4 个 TeamCity 构建配置同步更新了回调令牌和隧道地址。

SSH 配置按已有服务器记录迁移到独立 Include 文件，原 `m2` 配置及密钥未覆盖，原配置备份位于远端 `backups/ssh-config-before`。现有应用会自动发现目标账号原有 SSH 别名；新增自动发现项不代表本次已逐台验收所有服务器。连接验收范围见下表。

## 实际验收

| 检查                                          | 结果                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| 目标机 ARM64 锁定依赖、Prisma 生成、应用构建  | 通过；原生密码哈希依赖运行正常                             |
| Web 页面、静态资源、同站 `/api/` 代理         | 通过；生产构建显式设置 `VITE_API_BASE_URL=''`              |
| 原管理员真实浏览器登录与受权 API              | 通过                                                       |
| 既有 GitLab、TeamCity、两个 Registry 连接测试 | 通过                                                       |
| 页面同步 TeamCity                             | 发现 0 条新构建，更新 47 条既有记录                        |
| TeamCity 主机 → 反向隧道 → 新 API             | 回放 #3807 结果返回 201、accepted=true，幂等新增镜像数为 0 |
| 使用目标数据库解密的原 TCR 凭据回读五个摘要   | 全部与既有记录一致，五个镜像均为 AVAILABLE                 |
| API 被终止后的 KeepAlive 自动恢复             | 通过；PID 53919 → 55446，真实入口恢复正常                  |
| Redis 重启后的队列持久化                      | 通过；10 条已完成任务的内容哈希不变                        |
| system launchd 注册与运行账号                 | 六个作业均运行，账号 m2                                    |
| 整机重新启动                                  | 未实测，避免中断共享主机其他服务                           |
| 主机电源设置                                  | sleep=0、autorestart=1；原值已备份                         |
| 原有 5180 Web、8000 API 文档入口              | 均返回 200，原进程保持运行                                 |
| 融合平台自动部署                              | 未启用；该应用部署记录仍为 0                               |

最新五个组件为 API、Worker、Migration、Web、Visualization，统一标签 `git-5784109a7495-b3807`，源码提交 `5784109a74954bf361450c579c2726fb52903f6a`。既有镜像 ID 与摘要均保留。浏览器实测证据：`.artifacts/deployment-m2-20261023/browser-acceptance.png`；各检查点及验收 JSON 也位于该目录，私密文件单独放在 `private/`。

安装时目标 Homebrew 的服务模板处理与当前配方不兼容，默认 post-install 服务配置返回错误；没有因此升级整机 Homebrew。实际 PostgreSQL 16.15、Redis 8.10.2、Nginx 1.31.8 二进制、独立初始化与本项目生成的 launchd 服务均已完成运行验收。本次不使用那些未生成成功的 Homebrew 默认服务文件。

## 运维与回退

查看单个服务：`sudo launchctl print system/com.deliveryhub.api`，其余标签替换为 `postgres`、`redis`、`worker`、`web`、`callback`。服务日志位于 `/Users/m2/services/deliveryhub/logs/`，原始配置为 `config/runtime.env`，不得把其中内容粘贴到日志或 Git。

发布基线为源仓库 `d58f615` 加本次已提交的 macOS 部署脚本和说明。目标 release 的 `release.json` 保存最终提交及关键文件哈希，迁移材料保留于 `backups/`。源数据未删除，后续本地开发不能直接解除只读并同时启动旧服务写入。

若需回退，先通过 `launchctl bootout system/com.deliveryhub.<服务>` 停止目标 Worker、API、Web、callback，等待进程真正退出，保留 PostgreSQL/Redis 以便导出目标新增数据。取得新的 `pg_dump -Fc` 和 Redis 一致性快照，保存目标随机密钥及校验清单，再决定恢复位置。回灌源端前必须确认没有双写，恢复目标新增记录，使用与新密文匹配的密钥和可读取 Redis 8 快照的 Redis 版本。旧 Redis 7 不能直接使用新的 Redis 8 RDB；未经反向恢复验证不能声称无损切回。

源数据库解除只读的命令仅供完成反向验收后使用：`ALTER DATABASE delivery_hub RESET default_transaction_read_only;`。原主机电源值为 sleep=1、autorestart=0，原 SSH 与电源配置均有备份。本次没有执行反向恢复或整机重启，不删除检查点，不改动融合平台运行实例。
