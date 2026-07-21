# Architecture

Delivery Hub 是 TypeScript Monorepo 中的模块化单体：React Web 调用 NestJS REST API，API 使用 PostgreSQL/Prisma 保存业务状态，BullMQ Worker 通过 Redis 执行外部系统同步和 CI 配置任务。

外部系统必须通过独立 Adapter 访问。Controller 只处理协议层，业务模块不直接拼接 GitLab、TeamCity 或 Registry 请求。耗时操作写入任务记录后交由 Worker，进度通过持久化步骤与后续 SSE 接口暴露。

部署模块通过本机 OpenSSH 配置连接目标服务器，读取或接收 Docker Compose 文件、更新指定服务镜像并记录执行结果。生产环境应使用权限受限的部署账号，并将 API 与 SSH 能力隔离在可信网络中。

当前不实现 Kubernetes；Server Agent 仍为后续能力。系统继续保持模块化单体，不拆分为微服务。
