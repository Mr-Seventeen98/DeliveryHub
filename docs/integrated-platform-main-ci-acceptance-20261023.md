# 融合平台 main 五组件 CI 验收记录

2026-10-23 已完成本次主线推进及真实提交触发验收。构建 3807 最终为 **SUCCESS**，DeliveryHub 为 **SUCCESS / VERIFIED**，本次五个镜像均为 **AVAILABLE**。原有构建方式保留，未执行自动部署。

## 主线与推送范围

- 远端 `main` 原为 `7a9b9936a6d53693edbb7948bad7cf04c1567735`，本地主线已有提交为 `65eed3d8aac4b6215ef8af47ecadf881fa20db4d`。CI 分支包含两者，先将本地 `main` 快进至 `32b648175c654524ecf9db05f7073d10f05f4c9b`，随后推送远端；没有强制更新或改写历史。
- 相对原本地主线，这次快进只更新 6 个 CI 配置、测试和文档文件。远端推进也包含原本地主线已提交的历史内容；未把主目录正在开发的水位告警等未提交代码纳入本次推送。
- 主目录另有任务并发写文件，未用旧快照覆盖它们，也未清理或暂存这些路径。本次新增主线说明在已有干净 worktree 单独提交，仅修改 `docs/ci-pipeline.md`。
- 最终源码提交为 **`5784109a74954bf361450c579c2726fb52903f6a`**，已推送 `refs/heads/main`；验收结束时远端主线仍为同一提交。
- 原有 `scripts/build-server-images.sh` 及 API、Worker、Migration、Web、Visualization 五个手工构建 Dockerfile，与原远端主线相比均无修改。

## TeamCity 与 DeliveryHub 配置

复用原有“融合平台”项目、整套 Build Configuration、应用、五个组件及 TCR 连接。DeliveryHub 接入配置任务 10 完成 100%，新建资源 0、复用资源 2，没有另建并行项目。

| 项目                | 验收值                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| DeliveryHub 应用 ID | `cca222dd-9166-48fe-b1be-2f19f01609e4`                                                      |
| 应用发布分支        | `main`                                                                                      |
| 提交后自动构建      | `autoBuildEnabled=true`                                                                     |
| VCS Root 显示名     | `operation_platform/integratedplatform (main)`                                              |
| VCS 默认分支        | `refs/heads/main`                                                                           |
| VCS 分支规格        | `+:refs/heads/main`                                                                         |
| VCS 触发过滤器      | 排除全部后仅允许 `<default>` 与 `refs/heads/main`                                           |
| Build Configuration | `DeliveryHub_Root_da8913e753_operation_platform_integratedplatform_4df91be95c_RepositoryCI` |
| 触发器              | 一个启用的 `vcsTrigger`，本轮触发器 ID 为 `TRIGGER_23`                                      |
| 构建配置暂停状态    | `paused=false`                                                                              |
| 实际执行步骤        | `prepare → test → build → verify → push → report`                                           |

切换时短暂暂停受管构建配置，完成分支、参数和触发器更新后恢复。保留原只读检出密钥、专用 Agent 池和回环回调通道。没有重启 TeamCity 服务或更改其他项目的构建配置。

## 本次真实主线构建

- [TeamCity #6 / ID 3807](http://111.22.145.236:25747/buildConfiguration/DeliveryHub_Root_da8913e753_operation_platform_integratedplatform_4df91be95c_RepositoryCI/3807)。
- 实际检出：`refs/heads/main` / `5784109a74954bf361450c579c2726fb52903f6a`。
- 触发来源：`vcs` / `jetbrains.git`；本轮没有通过构建入队接口手动创建构建。提交后请求立即检查变更，只加快 VCS 检测，不替代提交触发器。
- 时间：**2026-10-23 11:45:46 → 2026-10-23 12:29:04**（Asia/Shanghai），共 **43 分 18 秒**。
- DeliveryHub 构建 ID：`45d66c82-cead-40ad-bf73-e2eaaacbec91`，执行 `SUCCESS`、发布 `VERIFIED`。
- 页面确认“成功”“整套已校验 · 5 个已登记镜像”，并展开核对了五镜像标签与摘要。

## 测试、重试与验证边界

自动测试最终通过 **1471 项**，失败 0、跳过 0；另有 **498 项最终镜像验证断言**。两类计数分别报告，TeamCity 原生名称合并计数不作为各归档报告求和的替代。

| 归档报告                 | 最终通过 | 失败 | 跳过 |
| ------------------------ | -------: | ---: | ---: |
| backend                  |      668 |    0 |    0 |
| web                      |      227 |    0 |    0 |
| browser-web              |       36 |    0 |    0 |
| visualization            |      520 |    0 |    0 |
| browser-visualization    |       20 |    0 |    0 |
| migration                |        3 |    0 |    0 |
| worker                   |        5 |    0 |    0 |
| production-web           |       51 |    0 |    0 |
| production-visualization |      439 |    0 |    0 |

管理端浏览器 36 项无重试通过项；可视化浏览器为 19 项直接通过、1 项重试后通过，最终 `unexpected=0`、`skipped=0`、`flaky=1`。重试项为：**project camera dialog shares overview controls, channel capabilities and preset operations**。首次出现 `Test timeout of 300000ms exceeded`，当时等待切换到不支持云台的通道；重试完成通道、云台、预置点及关闭预览断言。首次超时上下文和重试轨迹均归档，未写成全部首轮通过。

本轮可视化浏览器耗时约 **30.2 分钟**，是主要耗时来源。没有为使本轮通过而删用例、修改业务行为或临时放宽门控。

默认仍为 `functional` 的 20 个关键可视化用例，完整 95 用例保留为显式 `CI_VISUALIZATION_SUITE=full`，本轮未运行完整 95 用例。浏览器业务 API 使用既有合成契约，Cesium/WebGL 实际执行，不代表真实 OMP 或现场摄像头联调。另在相同 CI 代码的干净 worktree 运行 9 项 Python CI 保护测试，全部通过。

## 本次五个可用镜像

仓库位于 `ccr.ccs.tencentyun.com/fc17_dev`，共同标签为 **`git-5784109a7495-b3807`**，平台 `linux/amd64`。

| 组件          | 仓库                                | DeliveryHub 状态 | 真实 TCR 摘要                                                             |
| ------------- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| api           | `integrated-platform-api`           | `AVAILABLE`      | `sha256:0f788296f4c9e8ab32f6c10ec832ce26f62c9219bf0a695c6b3f30f0c0be1c0e` |
| worker        | `integrated-platform-worker`        | `AVAILABLE`      | `sha256:f72f9be92fbb584c62ccdb328ce5e52ddc5a3106e8029355e6741d7857e40ef2` |
| migration     | `integrated-platform-migration`     | `AVAILABLE`      | `sha256:df7f433969ff2caf50f923d09cd72c6062bb31040488f4248be47bef19e1536c` |
| web           | `integrated-platform-web`           | `AVAILABLE`      | `sha256:78ba5137c28a34357bb9ced0d6826faf1b6e7ab81715f7b89bbc6536a18f2444` |
| visualization | `integrated-platform-visualization` | `AVAILABLE`      | `sha256:bbcdee1706089cbc49e12fe60f53b2f8d2b169e3e52a98ebe70d0a2a232b46f2` |

先核对同次 TeamCity 归档，再独立调用真实 DeliveryHub RegistryClient 读取五个远端 manifest 摘要，全部一致；页面所用远端仓库目录中的镜像 ID、提交、标签和摘要也与登记记录一致。再次调用同步接口后，本次五个镜像的主键、数量、摘要和 AVAILABLE 状态保持不变。

构建 3806 的五个历史版本继续保留，不与本轮混为一套，也没有删除旧标签或改写历史失败记录。

## 运行与非部署验收

- 当前 [DeliveryHub 构建记录](http://localhost:5176/builds) 可实际登录访问。5173 已由另一个融合平台开发服务使用，本次按实际 5176 端口验收，没有停止或覆盖该开发服务。
- [API 健康接口](http://localhost:3000/api/v1/health) 返回应用和数据库正常。
- 当前没有该融合平台应用的 DeliveryHub 部署记录；本次没有调用创建部署接口，没有连接业务目标机执行发布或现网 SQL。
- 受管步骤不含自动部署，原有手工构建与发布入口保留。
- 构建 3807 的临时容器及私有临时目录已清理；专用 Agent 仍正常运行，重启策略 `unless-stopped`。

## 本地验收证据

以下公开证据位于 `.artifacts/remote-ci/`，仅保留在本地工作区，不随本验收文档提交；不包含密码、Token 或私钥。

- `main-merge-proof.json`、`main-source-commit.json`：快进关系、保护路径及主线说明提交。
- `main-provision-status.json`、`main-application-config.json`：DeliveryHub 配置切换和复用结果。
- `main-vcs-trigger-proof.json`、`main-push-trigger.json`：真实提交触发与检出身份。
- `acceptance-3807.json`：TC 最终状态、9 份报告、重试统计和本次五个 AVAILABLE 镜像。
- `registry-proof-3807.json`、`catalog-proof-3807.json`：独立 TCR 摘要及页面目录匹配结果。
- `build-3807-browser-web.json`、`build-3807-browser-visualization.json`：原始浏览器报告。
- `acceptance-3807-browser.png`：实际主线构建的最终页面截图。
- `closure-3807.json`：最终配置、幂等性、非部署状态及证据 SHA-256。

前次分支验证的历史记录见 [构建 3806 验收](integrated-platform-ci-acceptance-20261023.md)。本次以 main 的新构建 3807 独立完成验收。
