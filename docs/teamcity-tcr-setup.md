# TeamCity 与腾讯云 TCR 配置

## TeamCity 前置条件

1. 创建供 Delivery Hub 使用的 TeamCity Access Token。
2. 在 TeamCity Root Project 上传名为 `haoyu-gitlab` 的 SSH Key，私钥必须有权只读拉取 GitLab 仓库。
3. 至少启动一个 TeamCity Agent，并确认 Agent：
   - 在线且 Enabled。
   - 安装 Docker CLI/Engine。
   - 安装 `curl`、`grep`、`sed`、`tr`。
   - 能访问 GitLab、腾讯云 TCR 和 `PUBLIC_CALLBACK_BASE_URL`。
4. Root Project 中配置：
   - `env.TCR_USERNAME`：普通参数或安全参数。
   - `env.TCR_PASSWORD`：Password 类型参数。

Delivery Hub 为每个 Dockerfile 创建独立子项目，并在其中创建 VCS Root 和 Build Configuration。GitLab 拉取固定使用 TeamCity SSH Key `haoyu-gitlab`。

## TCR 固定配置

当前页面按项目约定固定使用：

```text
Registry:  ccr.ccs.tencentyun.com
Namespace: fc17_dev
```

用户只需要为每个组件填写镜像仓库名称，例如 `mobile.video.web`。完整地址会生成：

```text
ccr.ccs.tencentyun.com/fc17_dev/mobile.video.web:<tag>
```

腾讯云 TCR 仓库需要提前创建，并确保 TeamCity 使用的账号拥有 Push 权限。

## 生成的标签

每次成功构建推送：

- `git-<短 Commit SHA>`：不可变标签，部署时优先使用。
- `build-<TeamCity Build Number>`：不可变标签。
- `<branch>`：浮动分支标签。
- `latest`：浮动便捷标签。

Delivery Hub 镜像版本记录以 `git-<短 SHA>` 为主，并保存 Registry 返回的 Digest。

## 回调地址

`.env` 中的 `PUBLIC_CALLBACK_BASE_URL` 必须能从 TeamCity Agent 访问，例如：

```env
PUBLIC_CALLBACK_BASE_URL=http://delivery-hub.internal:3000
```

如果回调暂时不可达，构建状态仍由轮询同步，但镜像 Digest 只能在回调成功后写入。
