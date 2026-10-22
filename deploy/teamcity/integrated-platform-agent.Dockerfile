# 融合平台专用 TeamCity Agent 工具链。只承担测试、构建和推送，不包含应用部署命令。
# SDK 摘要来自首次远程验证的实际拉取结果；Node 下载时再核对官方 SHA256 清单。
FROM mcr.microsoft.com/dotnet/sdk:10.0.401-noble@sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317
ARG NODE_VERSION=24.15.0
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openjdk-21-jre-headless python3 git openssh-client curl ca-certificates unzip xz-utils \
    libglib2.0-0t64 libnss3 libnspr4 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 \
    libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libvulkan1 mesa-vulkan-drivers fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    && grep " node-v${NODE_VERSION}-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
    && rm "node-v${NODE_VERSION}-linux-x64.tar.xz" SHASUMS256.txt \
    && npm install --global pnpm@10.30.3
# 启动时挂载服务端提供的 Agent 目录；Docker CLI 与插件从宿主机只读挂载，避免版本错配。
# work/temp/system 使用与宿主机一致的绝对路径，确保 Compose 的 bind mount 指向本次 checkout。
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_PROCESSOR_COUNT=8
CMD ["/opt/buildagent/bin/agent.sh", "run"]
