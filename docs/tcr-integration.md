# Registry integration

领域模型使用通用 `RegistryConnection`，腾讯云 TCR 是首个实现。用户名和密码分别引用加密 Credential；镜像由 registry、namespace、repository、tag 和 digest 标识，不与部署服务器直接绑定。
