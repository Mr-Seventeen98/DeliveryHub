# GitLab integration

GitLab 仅通过 REST API 接入。Token 将由 Credential 模块使用 AES-256-GCM 加密保存，API 与日志不得返回明文。第一阶段支持 Personal、Group 和 Project Access Token；组级同步优先使用 Group Access Token。
