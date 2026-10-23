# 仓库整套自动发布

保留原单镜像 Compose 部署；新增数据库持久化的目录策略与 RepositoryDeployment。API 后台扫描构建同步已登记的 SUCCESS + VERIFIED 记录，不向 TeamCity 增加发布密钥，不在构建脚本内直接部署。

管理员配置接口：`PUT /api/v1/deployments/automatic-policies/:deploymentDirectoryId`，请求 `{ "enabled": true, "branch": "main", "runnerPath": "scripts/deploy-verified-release.py" }`。先在应用中建立关联 ONLINE SSH 服务器的部署目录；发布分支必须与应用 releaseBranch 相同，策略只接收启用/重新配置时刻之后开始的完整仓库构建。关闭时 enabled=false；重新启用不补发历史。策略变更写审计。初次配置走管理员 API，部署记录页显示策略和执行结果。

每轮选取最新合格构建，校验五个同提交 AVAILABLE 镜像及摘要，生成固定摘要清单。数据库租约覆盖 SSH 的最长执行窗口，唯一键防止同目录同构建重复登记；执行器从该构建完整提交获取，远端必须持有目录级锁，以收据实现幂等和单调版本保护。发布不与旧构建混合镜像。

执行器协议：Python3 标准库脚本接收一个清单文件参数；schemaVersion=1，releaseId 是发布 UUID，buildId 为 TeamCity 数字 ID，commitSha 为完整 SHA，directory 为已有目标目录，images 按 api/worker/migration/web/visualization 给出 fullName、digest、pinned。SSH 标准输入传递脚本、清单和 Registry 登录，临时 Docker 配置退出删除。脚本成功时 stdout 最后一行为 JSON，至少含 status=SUCCESS、commitSha、buildId；失败仅输出安全的阶段说明。

`GET /api/v1/deployments/automatic-policies` 和 `/repository-releases` 提供策略与最近100条记录。部署成功与构建成功分别记录，前端发布收据包含实际镜像、Migration 和回退目录。FAILED 不静默重试；SSH 超时不能证明远端停止，必须核对目标 releases 下的 started/receipt 与当前实例，不能靠删除记录强行重复。

本次融合平台执行器维护现有两套 Compose，先备份、本应用数据库转储和无新增 DDL 迁移预检，再协调独占 Worker/四个常驻服务，失败恢复原 Compose 与实例。新增 DDL 须单独审查执行。配置、卷、网关及回退细节见融合平台 `docs/34-automatic-uat-release.md`。

不设置默认自动部署目标，不影响未启用的其他应用；未完成、失败、取消、部分推送、缺摘要、混合提交、其他分支和启用前构建均不会被选中。平台单实例扫描加数据库租约，远端锁防止因 SSH 中断产生并行消费者；旧手工入口继续由操作人明确触发。
