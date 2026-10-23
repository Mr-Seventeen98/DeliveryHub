# 仓库流水线：测试、构建与 TCR

原有 `COMPONENT_DOCKER` 保持每组件任务。新增 `REPOSITORY_PIPELINE` 从所选分支根目录 `delivery.yaml` 读取公开定义，只创建一条整套 TeamCity Build Configuration。配置变更后必须重新接入，配置摘要不匹配会在 prepare 阶段停止。

## 接入

1. 业务仓库提交 `delivery.yaml` 及其受管脚本、Dockerfile、资产锁定文件。
2. 在 GitLab 项目的 CI 接入向导选择“仓库流水线”，读取当前分支的完整组件清单。
3. 选择已启用的 TCR 连接、TeamCity 组和分支，确认是否开启提交后触发及首次构建。
4. 受管任务强制 Agent checkout，以保留脚本验证所需的 .git；参见 [TeamCity checkout 说明](https://www.jetbrains.com/help/teamcity/vcs-checkout-mode.html)。Agent 提供 Python 3、业务锁定的 Node/pnpm/.NET、Docker/Compose/Buildx 和 Chromium 依赖。业务脚本负责工具链预检。
5. 公开资产通过 `CI_ASSET_SOURCE` 指向版本化只读目录或 HTTPS 数据集根地址；不得依赖开发机私人文件。

TeamCity 凭据使用 password 类型的环境参数。推送使用任务专属 Docker 登录目录，不覆盖 Agent 的全局登录。配置文件只包含公开路径和镜像名称，禁止放连接串、账号密码、Token 或任意部署命令。

## 生命周期与兼容

受管阶段为 prepare → test → build → verify → push，report 始终尽量执行以发送结果并清理本次临时资源。单应用最大并发为 1。原组件模式继续使用原任务；存在排队/运行批次时拒绝切换模式，结束后切换只关闭本应用旧受管触发器，保留任务与历史。

一条 Build 代表一次整套构建，componentId=null，关联多条 ImageVersion。Build.status 是 TC 执行状态；publicationStatus 单独记录 PENDING/NONE/PARTIAL/PENDING_VERIFY/VERIFIED。TC 成功不意味着镜像集合已登记。

只有配置/提交身份匹配、全部阶段成功、必跑报告非零且无失败/必跑跳过、完整组件集合及全部 TCR digest 回读一致后，才在同一事务写入整套 AVAILABLE 镜像。部分推送保留清单但不创建半套可用版本。迟到的回调不能降级 VERIFIED。

结果归档在 TC 的 `ci/result.json`；回调中断后同步任务读取该文件补登记，不重新运行测试、构建或推送。取消、Agent 中断或没有归档时显示实际执行/同步状态，不伪造成功。

## 数据库与验证

新增 Prisma migration `20261022100000_repository_pipeline`，为应用/构建增加可空快照及阶段表；旧记录默认保留组件模式。升级应用前执行常规数据库 migration，禁止使用 db push 替代版本迁移。

本地执行 `pnpm db:generate`、`pnpm typecheck`、`pnpm test`、`pnpm lint`、`pnpm build`。边界测试覆盖路径注入、缺失/重复组件、必跑跳过、TC 失败、第五镜像摘要失败及并发迟到回调。真实 GitLab/TC/TCR 联调和本地替身测试分别报告。

本功能不调用 Deployment 模块，不连接业务目标服务器，不执行现网 SQL。

融合平台五组件的真实远程构建与本地补同步验收，见 [2026-10-23 最终验收记录](integrated-platform-ci-acceptance-20261023.md)。
