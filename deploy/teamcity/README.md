# 融合平台专用 CI Agent

`integrated-platform-agent.Dockerfile` 提供 Node 24、pnpm 10.30.3、.NET SDK 10.0.401、Java 21 和 Chromium 系统依赖。它不包含应用发布逻辑。TeamCity 项目、Git 仓库绑定、六个阶段和 VCS 提交触发器仍由 DeliveryHub 的仓库流水线接入流程创建。

启动前从当前 TeamCity 的 `/update/buildAgent.zip` 下载 Agent，解压到专用目录；不要复用其他 Agent 的授权配置。该目录的 `conf/buildAgent.properties` 需配置 `serverUrl`、唯一 `name`，以及独立的 `workDir`、`tempDir`、`systemDir`。配置文件可能被 Agent 写入授权令牌，应限制目录和文件权限。

将融合平台 `scripts/ci/export_assets.py` 导出的资源包同步到专用资产目录，并通过 Agent 的 `env.CI_ASSET_SOURCE` 指向它。资源摘要由仓库中的资产锁再次验证，不需要把地形文件提交到 Git。建议设置 `env.TZ=Asia/Shanghai` 与已有测试环境一致。

容器须使用 Linux amd64、宿主机网络和独立资源限额；将 Agent 根目录挂到 `/opt/buildagent`，并将专用工作目录以**相同绝对路径**同时提供给宿主机和 Agent。原因是测试阶段通过宿主机 Docker 创建隔离依赖，Compose 的文件挂载必须能解析到相同 checkout。只读挂载宿主机 Docker CLI 与 CLI 插件，挂载 Docker socket供本次测试和镜像构建使用。

创建只关联“融合平台”项目的独立 Agent Pool，再将这个新 Agent 加入该池并授权；不要调整既有项目的池和 Agent。流水线只监听接入时选择的 Git 分支，依次运行 prepare、test、build、verify、push，最后始终执行 report 清理并保存结果。

DeliveryHub 的回调地址须能被 Agent 访问。本地验证可使用只绑定远程 loopback 的 SSH 反向转发，避免开放新的公网端口；该转发依赖本机在线。TeamCity 归档的 `ci/result.json` 仍可供 DeliveryHub 轮询恢复登记，不能把回调送达本身当成五个镜像已验证。

本阶段不创建部署步骤、部署触发器或服务重启任务；原有 Dockerfile、发布脚本和构建配置继续保留。
