# TeamCity #3808 分支错误与浏览器验收修复

## 现象与原因

2026-10-23，融合平台仓库流水线的 TeamCity #3808（Build #7）在开始时报告 `invalid_branch_name`，随后仍运行测试。实际检出提交为 `5784109a74954bf361450c579c2726fb52903f6a`，但本次触发传入 `branchName=main`，项目受管 VCS Root 的默认分支及 TeamCity 逻辑分支名是 `refs/heads/main`。TeamCity 找不到对应分支后回退默认提交，同时把构建判为失败。

代码检查同时发现，仓库流水线新增的手动构建入口直接使用应用的发布分支短名；原组件入口此前已转换为完整 Git 引用。#3808 的 TeamCity 记录显示用户触发，DeliveryHub 中则是同步发现的 VCS 类型且无发起人，入口日志也未找到对应网页触发请求，因此不把这轮构建的发起入口断言为 DeliveryHub。已证实的直接原因是入队分支名不匹配，新增入口的同类缺口也一并修复。首次构建入口也会传短名，因此只在仓库服务单点补转换不能覆盖所有入口。

TeamCity 的入队分支字段使用其逻辑分支名，具体名称取决于 VCS Root 的分支规则；本项目受管配置采用完整引用。参见 [官方分支规则](https://www.jetbrains.com/help/teamcity/working-with-feature-branches.html) 与 [构建触发 API](https://www.jetbrains.com/help/teamcity/rest/start-and-cancel-builds.html)。本修复不将这种名称规则扩张为所有外部 TeamCity 项目的通用规则。

## 修改范围

- 在 `TeamCityClient.queueBuild` 的 HTTP 边界统一转换发布分支：`main` → `refs/heads/main`；已有完整引用保持原值，带目录的分支保留其完整路径。
- 该入口同时覆盖仓库手动重试、创建后首次构建和既有组件构建。
- 不改应用页面中的 `main` 设置、GitLab 默认分支或 TeamCity 提交触发规则；保留既有构建方式，不增加自动部署。
- 增加三个 HTTP 请求体契约用例，使用外部请求客户端替身，覆盖短名、完整引用与多段分支，不根据实现代码推导预期值。

## 本地与服务验证

- 后端完整测试：19 个测试文件、96 项测试通过。
- 类型检查与变更文件 ESLint 通过；格式及 diff 检查通过。
- macOS ARM64 上独立 release 构建通过，仅切换 DeliveryHub 当前 release 并重启 API；原 release 及数据保留。
- 已停止被 TeamCity 判失败的 #3808，保留其日志、分支错误及取消记录；它尚未推送本轮镜像。
- 从部署后的 DeliveryHub 实际 `/builds/trigger` 接口触发 #3809（Build #8），分支正确识别为 `refs/heads/main`、默认分支为 true，检出提交仍为 `5784109a74954bf361450c579c2726fb52903f6a`。
- #3809 没有分支错误，但摄像头弹窗浏览器用例首次与重试均达到 300 秒上限，随后取消；不能将此轮写为整套通过。Trace 中多个正常操作耗时数十秒。
- 融合平台另提交 `1902ddc`：仅为 CI `functional` 浏览器套件启用应用已有的减少动态效果模式，保留全部真实 WebGL、点击、布局、通道能力、云台及预置点断言，不修改测试数量、超时、重试或生产代码；普通开发和 `full` 视觉套件保持原动效。在同一 Linux Agent 关闭重试复测该摄像头用例，首次通过，实际总耗时 93.6 秒。9 项 CI 脚本保护测试及 20 项功能用例发现检查通过。已推送远端 `main`，由既有提交触发器进行完整复验。
- `main` 的原提交触发器实际启动 #3810（Build #9），检出 `1902ddcdeaecd50e7ba3b13306a43b0b52922a05`。后端 668、后台单元 227、后台浏览器 36、大屏单元 520 均通过；六视口浏览器用例两次失败后取消，未进入构建和推送。
- 六视口失败暴露了测试中跨响应式布局异步测量的风险：旧地图安全盒与新工具栏直接比较。后续将两者及相关按钮、署名几何放进一次同步 DOM 测量，并在既有总预算内等待所有边界同时成立。单独复测已通过前五种视口，最后 390px 的“至少一个名称可见”断言又与 `docs/30-tenant-overview.md` 已确认的“拥挤时隐藏卡片并保留点位及项目清单”规则不符。因此窄屏改为验证四点可见、完整名称、清单及真实点击；640px 及以上仍要求名称可见。减少动态效果也缩小到 CI 摄像头弹窗专项，其他功能和视觉用例恢复原动效。没有修改生产行为或像素容差。

## 最终 CI 验收

最终通过构建：[TeamCity #3811 / Build #10](http://111.22.145.236:25747/buildConfiguration/DeliveryHub_Root_da8913e753_operation_platform_integratedplatform_4df91be95c_RepositoryCI/3811)。由既有 main 提交触发器发起，实际分支 `refs/heads/main`，检出 `75af994d29bf71fe0c2a22822405d4b0facced7e`，终态为 `finished / SUCCESS`；2026-10-23 16:36:57 完成。后端 668、后台单元 227、后台浏览器 36、大屏单元 520、大屏功能浏览器 20，共 1,471 项必跑测试最终零失败、零跳过。完整可选视觉套件仍为 95 项，本轮没有将它计入已运行数量。

后台浏览器 36 项均首次通过；大屏 19 项首次通过，项目页桌面/短屏/手机布局用例首次间距断言失败，在既有的一次新上下文重试后通过。该首次失败与重试 trace 保留，不宣称首次全部通过。摄像头专项和总览六视口本轮均首次通过。

五镜像构建及实际运行验证通过：Migration 3、Worker 5、后台资源 51、大屏资源 439，共 498 项额外断言；API 镜像存活检查通过。五个 TCR manifest 的 config 回指本地已验证 image ID。DeliveryHub 记录 `SUCCESS / VERIFIED`，构建记录 ID 为 `bb7adc6b-99a5-45ef-8567-c9b20eb880ec`；五镜像均为 `AVAILABLE`，标签统一为 `git-75af994d29bf-b3811`。又从 192.168.1.13 使用迁移后的加密凭据和实际 RegistryClient 独立回读五个摘要，全部一致。

| 镜像仓库                            | 状态        | 远端摘要                                                                  |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `integrated-platform-api`           | `AVAILABLE` | `sha256:786d1f64b20ea38649dba4560a1973feeb16c788f8c61ee5be786dbd5357a379` |
| `integrated-platform-migration`     | `AVAILABLE` | `sha256:e1a1427d8dafd06327b826a5d5d916c6942d861e0460cbe21b1206675eb47ed7` |
| `integrated-platform-visualization` | `AVAILABLE` | `sha256:fd2d728bd5ac5f9895e4596a7ba3bd53d717ac2b7cb7960d6aebfdca572d01a8` |
| `integrated-platform-web`           | `AVAILABLE` | `sha256:3fd5c00157a0fdb8de818a3e776339381d9f0160bd837f3a493eebe80125fed7` |
| `integrated-platform-worker`        | `AVAILABLE` | `sha256:66978a82bf17fdbb19f354e7672f119406e9414bd4bb2bfc5453325eb61ddee2` |

原 #3808、后续失败验收 #3809/#3810 保留为取消记录，不覆盖日志，不登记这些轮次的新镜像。原手工构建方式保留；本次只部署 DeliveryHub 的修复，不运行融合平台发布脚本、不更新业务服务器、不执行现网迁移。

原始证据保存于 `.artifacts/ci-3808/`：原构建日志及问题、修复发布信息、新构建请求和进度。凭据仅保存在受限私密目录，不加入 Git。
