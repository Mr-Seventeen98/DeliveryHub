# 融合平台五组件 CI 最终验收记录

验收时间：2026-10-23 11:33（Asia/Shanghai）。范围为恢复本地运行、归档补同步、五镜像登记及摘要核验，不包含业务部署。本次收尾未修改业务代码或构建脚本。

## 结论与版本

- 远程 TeamCity 构建 **#5 / ID 3806**：`SUCCESS`，触发来源为 `vcs`。
- DeliveryHub 同次构建：`SUCCESS` / `VERIFIED`，关联 **5 个 `AVAILABLE` 镜像**。
- 五个镜像的源码、标签、构建关联和 TCR 摘要全部一致；重复同步后镜像主键、数量和摘要不变。
- 当前提交触发分支：`codex/integrated-five-component-ci`；没有合并或切换到融合平台 `main`。
- 未执行自动部署，也未重新运行已经成功的测试、构建或推送。

| 项目                           | 验收身份                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| DeliveryHub 代码提交（已推送） | `6fe487f4a98bd37f458f4e919f72772509983896`                                                  |
| 融合平台代码提交（已推送）     | `32b648175c654524ecf9db05f7073d10f05f4c9b`                                                  |
| DeliveryHub 应用 ID            | `cca222dd-9166-48fe-b1be-2f19f01609e4`                                                      |
| DeliveryHub 构建 ID            | `a6d05ba9-4449-481c-9713-42c415daff0c`                                                      |
| TeamCity Build Configuration   | `DeliveryHub_Root_da8913e753_operation_platform_integratedplatform_4df91be95c_RepositoryCI` |
| 定义 SHA-256                   | `10767601ff1d34944a5df6385fac71c3ae97b866ebcf60366d222ed29dcd40c1`                          |
| 镜像平台                       | `linux/amd64`                                                                               |
| TCR 命名空间                   | `ccr.ccs.tencentyun.com/fc17_dev`                                                           |
| 五镜像共同标签                 | `git-32b648175c65-b3806`                                                                    |

[远程成功构建及日志](http://111.22.145.236:25747/buildConfiguration/DeliveryHub_Root_da8913e753_operation_platform_integratedplatform_4df91be95c_RepositoryCI/3806)。构建于 2026-10-23 01:19:14（Asia/Shanghai）结束。

## 本地恢复与补同步

1. 通过 Docker Desktop 自带启动命令恢复引擎，当前引擎版本 `29.7.2`。
2. 在已有 `.env` 和数据卷上运行仓库 `start.sh`，恢复 `deploy-postgres-1`、`deploy-redis-1` 及 API、Web、Worker。两个依赖容器均为 `healthy`，未重置数据卷；14 个已有迁移无待执行项，已有管理员账号未改密码。
3. 健康接口返回 `status=ok`、`database=ok`，浏览器使用已有管理员账号重新登录成功。
4. 服务恢复后，既有轮询已从 TeamCity `ci/result.json` 补登记构建 3806。另调用真实 `POST /api/v1/builds/sync` 确认同步，随后再次同步核对幂等性，没有重复镜像。
5. 独立运行 DeliveryHub `RegistryClient.getManifestDigest`，重新读取五个 TCR 镜像摘要，并与同次 TeamCity 归档和 DeliveryHub 记录逐项比较。
6. 镜像页面使用的远端仓库目录接口也返回相同的五个已入库版本，镜像 ID、提交和摘要与本地记录一致。实际浏览器显示“成功”“整套已校验 · 5 个已登记镜像”，展开后可见全部报告与五镜像摘要。

| 入口                                                | 当前验证结果                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| [DeliveryHub](http://localhost:5173)                | 登录及页面访问成功                                                             |
| [构建记录](http://localhost:5173/builds)            | 融合平台 Build #5 成功，整套已校验，5 个镜像                                   |
| [镜像版本](http://localhost:5173/images)            | 五个仓库可见；API 镜像新标签展示 Build #5 和对应摘要                           |
| [本地健康接口](http://localhost:3000/api/v1/health) | HTTP 200，应用及数据库正常                                                     |
| 既有回调通道                                        | 远端仅监听 `127.0.0.1:33030`，经 SSH 转发至本地 `127.0.0.1:3000`，健康检查通过 |

本次通过归档补同步完成验收，没有伪造或重放成功回调。回调通道随本地进程运行；它的健康检查证明当前网络可达，不代表重新执行过构建回调。归档补偿不依赖回调必须成功。

## 五个可用镜像

以下仓库均位于 `ccr.ccs.tencentyun.com/fc17_dev`，使用共同标签 `git-32b648175c65-b3806`。

| 组件          | 仓库                                | DeliveryHub 状态 | 已核验摘要                                                                |
| ------------- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| API           | `integrated-platform-api`           | `AVAILABLE`      | `sha256:c43553de60e52d05eaea7cb7dd908e9350912645302c6bb792d42110d700efd7` |
| Worker        | `integrated-platform-worker`        | `AVAILABLE`      | `sha256:2d7d82cbc7536413345cb0fab980a7587dc8d7ee52728eb330135e6a7c3a70a4` |
| Migration     | `integrated-platform-migration`     | `AVAILABLE`      | `sha256:a8d481d0caba05c546a3b9a5bac4b185dab8c06e285e88ed9e1fb235325724fd` |
| Web           | `integrated-platform-web`           | `AVAILABLE`      | `sha256:2491616a08d7f677f71e1986f982584bfb7c16c1c5a7b7d5148b346d7c9b9794` |
| Visualization | `integrated-platform-visualization` | `AVAILABLE`      | `sha256:10a130018cd2ee893f8fcc6f35f6acb79f7583c091e16d75ad1d06ac0ae851af` |

## 测试与镜像验证范围

构建 3806 的归档报告如下，失败及跳过均为 0。自动测试共 **1471** 项；另外 **498** 项属于最终镜像验证断言，不合并宣称为单元测试数量。TeamCity 原生界面按其测试名称合并规则显示的计数与各报告求和可能不同。

| 归档报告                             | 最终通过数 |
| ------------------------------------ | ---------: |
| backend                              |        668 |
| web                                  |        227 |
| browser-web                          |         36 |
| visualization                        |        520 |
| browser-visualization                |         20 |
| migration（镜像验证）                |          3 |
| worker（镜像验证）                   |          5 |
| production-web（镜像验证）           |         51 |
| production-visualization（镜像验证） |        439 |

可视化浏览器默认运行 20 个关键用例，完整 95 用例保留为 `CI_VISUALIZATION_SUITE=full` 选项；本次远程成功构建没有运行完整 95 用例。默认用例中，布局适配用例重试一次后通过，原始 Playwright 报告为 `expected=19`、`flaky=1`、`unexpected=0`。管理端浏览器 36 个用例无重试失败记录。验收保留这个稳定性限制，不将最终绿色等同全部首轮通过。

## 运行与部署边界

- TeamCity 当前有启用的 VCS 触发器，受管步骤只有 `prepare → test → build → verify → push → report`。
- 融合平台的原有构建入口保留；本次没有修改原有构建方式。
- 构建 3805 的历史失败和其他取消记录保留，没有改写为成功或将它们的镜像混入构建 3806。
- 远端专用 Agent 仍为 `running`，重启策略为 `unless-stopped`；构建 3806 的临时容器和私有临时目录已不存在。
- DeliveryHub 中该融合平台应用的部署记录为 0。本次没有调用创建部署接口，也没有执行业务目标机发布、Compose 更新或业务数据库迁移。
- 当前本地开发服务已保留运行。以后需要恢复时，在本仓库、Docker 就绪且目标端口空闲后执行 `env PATH=/usr/local/opt/node@24/bin:$PATH ./start.sh`。前台运行时用 Ctrl+C 停止 API、Web、Worker，数据库和 Redis 继续保留。
- 本次后台服务与回调通道的 PID、命令和日志位置分别记录在下列本地运行文件中；停止前先核对进程归属，避免按过期 PID 操作。

## 本地证据

下列文件只保存在当前工作区 `.artifacts/remote-ci/`，不随 Git 提交；公开证据不包含账号密码、Token 或私钥。

- `acceptance-3806.json`：真实 TC 状态、源码身份、9 份报告、浏览器重试统计及五个 AVAILABLE 镜像。
- `registry-proof-3806.json`：本次重新通过真实 RegistryClient 读取的五个摘要。
- `catalog-proof-3806.json`：页面所用远端仓库目录与本地镜像主键的逐项匹配。
- `closure-3806.json`：最终检查时间、健康、配置、幂等同步结果及证据 SHA-256。
- `acceptance-3806-browser.png`：实际登录后的成功构建与五镜像页面截图。
- `sync-3806.json`：手动确认同步的返回及当时构建状态。
- `local-runtime-20261023.json`、`local-runtime-20261023.log`：本地开发服务运行记录与日志。
- `callback-tunnel-runtime.json`：仅监听远端回环地址的既有转发通道运行记录。

此次验收确认的是自动测试、构建、推送和登记链路完成；业务部署继续保持未执行状态。
