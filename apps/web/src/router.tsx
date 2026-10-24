import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  Activity,
  ArrowUp,
  AppWindow,
  Boxes,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  Hammer,
  History,
  KeyRound,
  LogOut,
  MonitorCog,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  apiRequest,
  consumeApiEventStream,
  getAccessToken,
  login,
  logout as logoutSession,
} from "./api";
import {
  analyzeComposeContent,
  type ComposeServiceOption,
} from "./compose-analysis";
import { resolveRepositoryRef } from "./gitlab-branches";

const navigationGroups = [
  {
    id: "workbench",
    label: "工作台",
    subtitle: "交付状态 · 快速入口",
    icon: Activity,
    defaultTo: "/",
    items: [{ label: "交付概览", to: "/", icon: Activity }],
  },
  {
    id: "projects",
    label: "项目接入",
    subtitle: "GitLab · 应用向导",
    icon: FolderGit2,
    defaultTo: "/gitlab",
    items: [
      { label: "GitLab 项目", to: "/gitlab", icon: GitBranch },
      { label: "TeamCity 连接", to: "/teamcity", icon: Hammer },
      { label: "应用接入", to: "/applications", icon: AppWindow },
    ],
  },
  {
    id: "delivery",
    label: "构建交付",
    subtitle: "构建记录 · 镜像版本",
    icon: Boxes,
    defaultTo: "/images",
    items: [
      { label: "镜像版本", to: "/images", icon: Package },
      { label: "构建记录", to: "/builds", icon: Hammer },
    ],
  },
  {
    id: "operations",
    label: "部署运维",
    subtitle: "环境 · 目标 · 部署",
    icon: Server,
    defaultTo: "/servers",
    items: [
      { label: "部署目标", to: "/servers", icon: MonitorCog },
      { label: "部署记录", to: "/deployments", icon: History },
    ],
  },
] as const;

const FIXED_IMAGE_REGISTRY = "ccr.ccs.tencentyun.com";
const FIXED_IMAGE_NAMESPACE = "fc17_dev";

function Root(): React.ReactElement {
  return <Outlet />;
}

function Shell(): React.ReactElement {
  const authenticated = Boolean(getAccessToken());
  useServerStatusEvents(authenticated);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (!authenticated) return <Navigate to="/login" />;

  const activeGroup =
    navigationGroups.find((group) =>
      group.items.some((item) => item.to === pathname),
    ) ?? navigationGroups[0];
  const currentItem =
    activeGroup.items.find((item) => item.to === pathname) ??
    activeGroup.items[0];
  const showSecondaryMenu = activeGroup.items.length > 1;

  function logout(): void {
    void logoutSession().finally(() => window.location.assign("/login"));
  }

  return (
    <main className="omp-layout">
      <aside
        className={`omp-sider ${showSecondaryMenu ? "" : "is-primary-only"}`}
      >
        <div className="omp-primary">
          <Link aria-label="交付中心首页" className="omp-logo" to="/">
            <img alt="" className="brand-mark" src="/app-icon.svg" />
          </Link>
          <nav aria-label="主导航" className="omp-primary-menu">
            {navigationGroups.map((group) => {
              const Icon = group.icon;
              return (
                <Link
                  className={`omp-primary-item ${
                    activeGroup.id === group.id ? "is-active" : ""
                  }`}
                  key={group.id}
                  to={group.defaultTo}
                >
                  <Icon size={22} />
                  <span>{group.label}</span>
                </Link>
              );
            })}
          </nav>
          <button
            aria-label="退出登录"
            className="omp-logout"
            onClick={logout}
            type="button"
          >
            <LogOut size={20} />
          </button>
        </div>
        {showSecondaryMenu ? (
          <div className="omp-secondary">
            <div className="omp-secondary-head">
              <strong>{activeGroup.label}</strong>
              <span>{activeGroup.subtitle}</span>
            </div>
            <nav
              aria-label={`${activeGroup.label}导航`}
              className="omp-secondary-menu"
            >
              {activeGroup.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    className={`omp-secondary-item ${
                      item.to === pathname ? "is-active" : ""
                    }`}
                    key={item.to}
                    to={item.to}
                  >
                    <Icon size={16} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}
      </aside>
      <section className="omp-main">
        <header className="omp-header">
          <div className="omp-breadcrumb">
            <span>交付中心</span>
            <span>/</span>
            <strong>{currentItem.label}</strong>
          </div>
          <div className="header-actions">
            <span className="runtime-status">
              <i />
              本地开发
            </span>
            <button className="icon-button" onClick={logout} type="button">
              <LogOut size={16} />
              退出
            </button>
          </div>
        </header>
        <div className="omp-content">
          <Outlet />
        </div>
      </section>
    </main>
  );
}

function useServerStatusEvents(enabled: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    const connect = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        try {
          await consumeApiEventStream<
            | { type: "server.updated"; data: ServerRecord }
            | { type: "servers.changed"; data: { at: number } }
            | { type: "heartbeat"; data: { at: number } }
          >(
            "/servers/events",
            (event) => {
              if (event.type === "server.updated") {
                queryClient.setQueryData<ServerRecord[]>(
                  ["servers"],
                  (servers) =>
                    servers?.map((server) =>
                      server.id === event.data.id ? event.data : server,
                    ),
                );
              } else if (event.type === "servers.changed") {
                void queryClient.invalidateQueries({ queryKey: ["servers"] });
              }
            },
            controller.signal,
          );
        } catch {
          // A short reconnect delay prevents a failed endpoint from creating a loop.
        }
        if (!controller.signal.aborted) {
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
        }
      }
    };

    void connect();
    return () => controller.abort();
  }, [enabled, queryClient]);
}

function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const [username, setUsername] = useState(import.meta.env.DEV ? "admin" : "");
  const [password, setPassword] = useState(
    import.meta.env.DEV ? "delivery-local-admin" : "",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
      await navigate({ to: "/" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="login-logo">
          <img alt="" className="brand-mark" src="/app-icon.svg" />
        </div>
        <span className="eyebrow">交付中心</span>
        <h1>登录研发交付平台</h1>
        <p>使用本地管理员账号进入研发交付工作台。</p>
        <label>
          用户名
          <input
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            value={username}
          />
        </label>
        <label>
          密码
          <div className="password-field">
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              className="password-toggle"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </label>
        {error ? <div className="error-message">{error}</div> : null}
        <button
          className="primary-button login-submit"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="workbench-head page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {action}
    </section>
  );
}

function DashboardPage(): React.ReactElement {
  const applications = useQuery({
    queryKey: ["applications"],
    queryFn: () => apiRequest<Array<{ id: string }>>("/applications"),
  });
  const builds = useQuery({
    queryKey: ["builds", "dashboard"],
    queryFn: () =>
      apiRequest<{
        items: Array<{
          id: string;
          status: BuildStatusValue;
          teamCityBuildNumber: string;
          application: { name: string };
          component: { name: string } | null;
          createdAt: string;
        }>;
        total: number;
      }>("/builds?page=1&pageSize=10"),
    refetchInterval: 15_000,
  });
  const images = useQuery({
    queryKey: ["images", "dashboard"],
    queryFn: () =>
      apiRequest<{ items: unknown[]; total: number }>(
        "/images?page=1&pageSize=1",
      ),
    refetchInterval: 30_000,
  });
  const runningTasks =
    builds.data?.items.filter((build) =>
      ["QUEUED", "RUNNING"].includes(build.status),
    ).length ?? 0;
  const cards = [
    {
      label: "已接入应用",
      value: String(applications.data?.length ?? 0),
      icon: AppWindow,
    },
    {
      label: "构建记录",
      value: String(builds.data?.total ?? 0),
      icon: Hammer,
    },
    {
      label: "可用镜像",
      value: String(images.data?.total ?? 0),
      icon: Package,
    },
    { label: "运行中任务", value: String(runningTasks), icon: Activity },
  ];
  return (
    <section className="page-stack">
      <PageHeader
        action={
          <Link className="primary-button" to="/gitlab">
            <Plus size={17} />
            接入 GitLab 项目
          </Link>
        }
        eyebrow="研发交付 · CI/CD 编排"
        title="交付中心"
      />
      <section className="omp-alert neutral">
        基础服务已运行。请先配置 GitLab、TeamCity 和镜像仓库连接。
      </section>
      <div className="workbench-overview">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article className="workbench-stat-card" key={card.label}>
              <div className="workbench-stat-icon">
                <Icon size={20} />
              </div>
              <div>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            </article>
          );
        })}
      </div>
      <div className="workbench-grid">
        <section className="workbench-card">
          <h2>最近活动</h2>
          {builds.data?.items.length ? (
            <div className="list">
              {builds.data.items.slice(0, 5).map((build) => (
                <div className="row" key={build.id}>
                  <div>
                    <strong>{build.application.name}</strong>
                    <span>
                      {build.component?.name ?? "组件"} · Build #
                      {build.teamCityBuildNumber || "排队中"}
                    </span>
                  </div>
                  <span className={`status ${buildStatusClass(build.status)}`}>
                    {buildStatusLabels[build.status]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">尚无构建或接入记录。</div>
          )}
        </section>
        <section className="workbench-card">
          <h2>基础服务</h2>
          <div className="list">
            <div className="row">
              <div>
                <strong>PostgreSQL</strong>
                <span>业务数据库</span>
              </div>
              <span className="status success">正常</span>
            </div>
            <div className="row">
              <div>
                <strong>Redis</strong>
                <span>BullMQ 与缓存</span>
              </div>
              <span className="status success">正常</span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

interface GitLabConnection {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

interface GitLabProject {
  id: string;
  name: string;
  path: string;
  pathWithNamespace: string;
  namespaceName: string;
  webUrl: string;
  defaultBranch: string;
  visibility: string;
  archived: boolean;
  importStatus: "NOT_IMPORTED" | "IMPORTED" | "DISABLED";
  lastActivityAt: string | null;
  gitLabInstance: { id: string; name: string };
  teamCityVcsRoots: Array<{
    id: string;
    name: string;
    teamCityProjectId: string;
    teamCityProjectName: string;
    teamCityConnection: { id: string; name: string; baseUrl: string };
  }>;
}

interface GitLabProjectPage {
  items: GitLabProject[];
  total: number;
  page: number;
  pageSize: number;
}

interface GitLabConnectionForm {
  name: string;
  baseUrl: string;
  apiUrl: string;
  token: string;
  verifySsl: boolean;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
}

interface CiCdComponentDraft {
  code?: string;
  id: string;
  name: string;
  sourceDirectory: string;
  dockerfilePath: string;
  buildContext: string;
  imageRepository: string;
  existing?: boolean;
}

interface CiCdSetupDraft {
  /** 仓库模式只创建一次整套任务；旧草稿缺省仍为组件 Docker 模式。 */
  ciExecutionMode?: "COMPONENT_DOCKER" | "REPOSITORY_PIPELINE";
  pipelineDefinitionPath?: string;
  registryConnectionId?: string;
  releaseBranch: string;
  teamCityConnectionId: string;
  teamCityGroupMode: "existing" | "new";
  teamCityGroupId: string;
  teamCityGroupName: string;
  autoBuildEnabled: boolean;
  runFirstBuild: boolean;
  components: CiCdComponentDraft[];
}

interface CiProvisioningResult {
  taskId: string;
  applicationId: string;
  teamCityGroup: { id: string; name: string; url: string };
  components: Array<{
    name: string;
    projectId: string;
    buildTypeId: string;
    url: string;
    queuedBuildId?: number;
  }>;
  createdResources: number;
  reusedResources: number;
}

interface ProvisioningJobStatus {
  jobId: string;
  status: string;
  progressPercent: number;
  currentStep: string | null;
  attemptsMade: number;
  errorMessage: string | null;
  result: CiProvisioningResult | null;
}

interface ExistingCiConfigurationResult {
  configured: boolean;
  configuration: {
    applicationId: string;
    ciExecutionMode: "COMPONENT_DOCKER" | "REPOSITORY_PIPELINE";
    pipelineDefinitionPath: string | null;
    registryConnectionId: string | null;
    releaseBranch: string;
    teamCityConnectionId: string;
    teamCityGroupId: string;
    teamCityGroupName: string;
    autoBuildEnabled: boolean;
    components: Array<{
      id: string;
      name: string;
      dockerfilePath: string;
      buildContext: string;
      imageRepository: string;
      teamCityBuildTypeId: string | null;
    }>;
  } | null;
}

interface GitLabBranchOption {
  name: string;
  default: boolean;
  protected: boolean;
}

interface GitLabDockerfileOption {
  id: string;
  name: string;
  path: string;
}

interface RepositoryScanResult {
  pipeline?: {
    sha256: string;
    definition: {
      components: Array<{
        code: string;
        name: string;
        dockerfile: string;
        context: string;
        imageRepository: string;
      }>;
    };
  };
  pipelineError?: string;
  ref: string;
  featureFiles: Array<{ path: string; kind: string }>;
  componentSuggestions: Array<{
    name: string;
    directory: string;
    dockerfilePath: string;
    type: string;
    evidence: string[];
  }>;
}

interface TeamCityProjectOption {
  id: string;
  name: string;
  parentProjectId: string;
}

function GitLabConnectionDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (message: string) => void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<GitLabConnectionForm>({
    name: "",
    baseUrl: "",
    apiUrl: "",
    token: "",
    verifySsl: true,
    syncEnabled: true,
    syncIntervalMinutes: 30,
  });

  function updateBaseUrl(baseUrl: string): void {
    setForm((current) => {
      const previousSuggestedApiUrl = current.baseUrl
        ? `${current.baseUrl.replace(/\/$/, "")}/api/v4`
        : "";
      const shouldUpdateApiUrl =
        !current.apiUrl || current.apiUrl === previousSuggestedApiUrl;
      return {
        ...current,
        baseUrl,
        apiUrl: shouldUpdateApiUrl
          ? `${baseUrl.replace(/\/$/, "")}/api/v4`
          : current.apiUrl,
      };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    let credentialId: string | undefined;
    try {
      const credential = await apiRequest<{ id: string }>("/credentials", {
        method: "POST",
        body: JSON.stringify({
          name: `${form.name} GitLab Token`,
          type: "GITLAB_TOKEN",
          secret: form.token,
        }),
      });
      credentialId = credential.id;
      await apiRequest<GitLabConnection>("/integrations/gitlab", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          apiUrl: form.apiUrl,
          tokenCredentialId: credential.id,
          verifySsl: form.verifySsl,
          syncEnabled: form.syncEnabled,
          syncIntervalMinutes: form.syncIntervalMinutes,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["gitlab-connections"] });
      onCreated("GitLab 连接已保存，Token 已加密存储。");
      onClose();
    } catch (reason) {
      if (credentialId) {
        await apiRequest(`/credentials/${credentialId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      setError(
        reason instanceof Error ? reason.message : "保存 GitLab 连接失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="drawer-mask"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside aria-label="新增 GitLab 连接" className="drawer-panel">
        <div className="drawer-head">
          <div>
            <strong>新增 GitLab 连接</strong>
            <span>连接 GitLab API，同步当前 Token 有权访问的项目。</span>
          </div>
          <button
            aria-label="关闭"
            className="drawer-close"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <form className="drawer-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>连接名称</span>
            <input
              autoFocus
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="例如：公司 GitLab"
              required
              value={form.name}
            />
          </label>
          <label>
            <span>GitLab 地址</span>
            <input
              onChange={(event) => updateBaseUrl(event.target.value)}
              placeholder="https://gitlab.example.com"
              required
              type="url"
              value={form.baseUrl}
            />
            <small>填写浏览器中访问 GitLab 的基础地址。</small>
          </label>
          <label>
            <span>GitLab API 地址</span>
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  apiUrl: event.target.value,
                }))
              }
              placeholder="https://gitlab.example.com/api/v4"
              required
              type="url"
              value={form.apiUrl}
            />
          </label>
          <label>
            <span>Access Token</span>
            <div className="password-field">
              <input
                autoComplete="off"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    token: event.target.value,
                  }))
                }
                placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                required
                type={showToken ? "text" : "password"}
                value={form.token}
              />
              <button
                aria-label={showToken ? "隐藏 Token" : "显示 Token"}
                className="password-toggle"
                onClick={() => setShowToken((value) => !value)}
                type="button"
              >
                {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <small>
              建议使用 Group Access Token；Token 仅以 AES-256-GCM 密文保存。
            </small>
          </label>
          <label>
            <span>同步间隔（分钟）</span>
            <input
              max={1440}
              min={5}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  syncIntervalMinutes: Number(event.target.value),
                }))
              }
              required
              type="number"
              value={form.syncIntervalMinutes}
            />
          </label>
          <div className="switch-list">
            <label className="switch-row">
              <span>
                <strong>验证 SSL 证书</strong>
                <small>生产环境应保持开启。</small>
              </span>
              <input
                checked={form.verifySsl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    verifySsl: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
            <label className="switch-row">
              <span>
                <strong>启用自动同步</strong>
                <small>按上述间隔同步项目元数据。</small>
              </span>
              <input
                checked={form.syncEnabled}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    syncEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
          <div className="drawer-actions">
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "保存中…" : "保存连接"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function CiCdSetupFlow({
  project,
  teamCityConnections,
  onClose,
  onConfirmed,
}: {
  project: GitLabProject;
  teamCityConnections: TeamCityConnection[];
  onClose: () => void;
  onConfirmed: (result: CiProvisioningResult) => void | Promise<void>;
}): React.ReactElement {
  const [step, setStep] = useState<"configure" | "confirm">("configure");
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState(0);
  const [provisionStep, setProvisionStep] = useState("");
  const [provisionError, setProvisionError] = useState("");
  const [dockerfilePickerOpen, setDockerfilePickerOpen] = useState(false);
  const [dockerfileSelection, setDockerfileSelection] = useState<string[]>([]);
  const [dockerfileSearch, setDockerfileSearch] = useState("");
  const [configurationHydrated, setConfigurationHydrated] = useState(false);
  const draftStorageKey = `delivery-hub:ci-draft:${project.id}`;
  const [draft, setDraft] = useState<CiCdSetupDraft>(() => {
    return {
      releaseBranch: project.defaultBranch || "main",
      ciExecutionMode: "COMPONENT_DOCKER",
      pipelineDefinitionPath: "delivery.yaml",
      teamCityConnectionId:
        project.teamCityVcsRoots[0]?.teamCityConnection.id ??
        teamCityConnections[0]?.id ??
        "",
      teamCityGroupMode: "new",
      teamCityGroupId: "",
      teamCityGroupName: project.name,
      autoBuildEnabled: true,
      runFirstBuild: false,
      components: [],
    };
  });
  const existingConfiguration = useQuery({
    queryKey: ["ci-configuration", project.id],
    queryFn: () =>
      apiRequest<ExistingCiConfigurationResult>(
        `/ci-configurations/gitlab-project/${project.id}`,
      ),
  });
  useEffect(() => {
    if (!existingConfiguration.isSuccess) return;
    const configuration = existingConfiguration.data.configuration;
    if (configuration) {
      setDraft({
        releaseBranch: configuration.releaseBranch,
        ciExecutionMode: configuration.ciExecutionMode,
        pipelineDefinitionPath:
          configuration.pipelineDefinitionPath ?? "delivery.yaml",
        registryConnectionId: configuration.registryConnectionId ?? undefined,
        teamCityConnectionId: configuration.teamCityConnectionId,
        teamCityGroupMode: "existing",
        teamCityGroupId: configuration.teamCityGroupId,
        teamCityGroupName: configuration.teamCityGroupName,
        autoBuildEnabled: configuration.autoBuildEnabled,
        runFirstBuild: false,
        components: configuration.components.map((component) => ({
          id: component.dockerfilePath,
          name: component.name,
          sourceDirectory: component.buildContext,
          dockerfilePath: component.dockerfilePath,
          buildContext: component.buildContext,
          imageRepository: component.imageRepository,
          existing: true,
        })),
      });
    } else {
      try {
        const saved = window.localStorage.getItem(draftStorageKey);
        if (saved) setDraft(JSON.parse(saved) as CiCdSetupDraft);
      } catch {
        window.localStorage.removeItem(draftStorageKey);
      }
    }
    setConfigurationHydrated(true);
  }, [
    draftStorageKey,
    existingConfiguration.data,
    existingConfiguration.isSuccess,
  ]);
  useEffect(() => {
    if (!configurationHydrated) return;
    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [configurationHydrated, draft, draftStorageKey]);
  const branches = useQuery({
    queryKey: ["gitlab-project-branches", project.id],
    queryFn: () =>
      apiRequest<{ items: GitLabBranchOption[] }>(
        `/gitlab-projects/${project.id}/branches`,
      ),
  });
  const repositoryRef =
    configurationHydrated && branches.isSuccess && !branches.isFetching
      ? resolveRepositoryRef(draft.releaseBranch, branches.data.items)
      : "";
  useEffect(() => {
    if (!repositoryRef || repositoryRef === draft.releaseBranch) return;
    setDraft((current) => {
      const nextRef = resolveRepositoryRef(
        current.releaseBranch,
        branches.data?.items ?? [],
      );
      return nextRef && nextRef !== current.releaseBranch
        ? { ...current, releaseBranch: nextRef }
        : current;
    });
  }, [branches.data?.items, draft.releaseBranch, repositoryRef]);
  const dockerfiles = useQuery({
    queryKey: ["gitlab-project-dockerfiles", project.id, repositoryRef],
    queryFn: () =>
      apiRequest<{ ref: string; items: GitLabDockerfileOption[] }>(
        `/gitlab-projects/${project.id}/dockerfiles?ref=${encodeURIComponent(repositoryRef)}`,
      ),
    enabled: Boolean(repositoryRef),
  });
  const repositoryScan = useQuery({
    queryKey: ["gitlab-project-repository-scan", project.id, repositoryRef],
    queryFn: () =>
      apiRequest<RepositoryScanResult>(
        `/gitlab-projects/${project.id}/repository-scan?ref=${encodeURIComponent(repositoryRef)}`,
      ),
    enabled: Boolean(repositoryRef),
  });
  const teamCityProjects = useQuery({
    queryKey: ["teamcity-projects", draft.teamCityConnectionId],
    queryFn: () =>
      apiRequest<{
        parentProjectId: string;
        items: TeamCityProjectOption[];
      }>(`/integrations/teamcity/${draft.teamCityConnectionId}/projects`),
    enabled: Boolean(draft.teamCityConnectionId),
  });
  const selectedTeamCity = teamCityConnections.find(
    (connection) => connection.id === draft.teamCityConnectionId,
  );
  const registries = useQuery({
    queryKey: ["pipeline-registries"],
    queryFn: () =>
      apiRequest<
        Array<{
          id: string;
          name: string;
          registryUrl: string;
          namespace: string;
          enabled: boolean;
        }>
      >("/integrations/registries"),
  });
  const pipelineMode = draft.ciExecutionMode === "REPOSITORY_PIPELINE";
  const selectedRegistry = registries.data?.find(
    (item) => item.id === draft.registryConnectionId,
  );

  /** 导入当前分支的权威清单；保存时后端还会重新读取，禁止浏览器私自删减组件。 */
  function selectRepositoryPipeline(): void {
    const pipeline = repositoryScan.data?.pipeline;
    if (!pipeline) return;
    setDraft((current) => ({
      ...current,
      ciExecutionMode: "REPOSITORY_PIPELINE",
      pipelineDefinitionPath: "delivery.yaml",
      components: pipeline.definition.components.map((item) => ({
        id: item.code,
        code: item.code,
        name: item.name,
        sourceDirectory: item.context,
        dockerfilePath: item.dockerfile,
        buildContext: item.context,
        imageRepository: item.imageRepository,
      })),
    }));
  }
  const selectedTeamCityGroup = teamCityProjects.data?.items.find(
    (item) => item.id === draft.teamCityGroupId,
  );
  const visibleDockerfiles = (dockerfiles.data?.items ?? []).filter((file) =>
    file.path.toLowerCase().includes(dockerfileSearch.trim().toLowerCase()),
  );
  const dockerfileGroups = Object.entries(
    visibleDockerfiles.reduce<Record<string, GitLabDockerfileOption[]>>(
      (groups, file) => {
        const separator = file.path.lastIndexOf("/");
        const directory =
          separator >= 0 ? file.path.slice(0, separator) : "仓库根目录";
        (groups[directory] ??= []).push(file);
        return groups;
      },
      {},
    ),
  ).sort(([left], [right]) => {
    if (left === "仓库根目录") return -1;
    if (right === "仓库根目录") return 1;
    return left.localeCompare(right);
  });

  function updateComponent(
    id: string,
    patch: Partial<CiCdComponentDraft>,
  ): void {
    setDraft((current) => ({
      ...current,
      components: current.components.map((component) =>
        component.id === id ? { ...component, ...patch } : component,
      ),
    }));
  }

  function removeComponent(id: string): void {
    setDraft((current) => ({
      ...current,
      components: current.components.filter((component) => component.id !== id),
    }));
  }

  function createComponent(file: GitLabDockerfileOption): CiCdComponentDraft {
    const separator = file.path.lastIndexOf("/");
    const sourceDirectory =
      separator >= 0 ? file.path.slice(0, separator) : ".";
    const directoryName =
      sourceDirectory === "."
        ? project.name
        : sourceDirectory.split("/").filter(Boolean).at(-1) || project.name;
    const normalizedName = directoryName
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .toLowerCase();
    const directoryFileCount =
      dockerfiles.data?.items.filter((candidate) => {
        const candidateSeparator = candidate.path.lastIndexOf("/");
        const candidateDirectory =
          candidateSeparator >= 0
            ? candidate.path.slice(0, candidateSeparator)
            : ".";
        return candidateDirectory === sourceDirectory;
      }).length ?? 1;
    const fileVariant =
      file.name
        .replace(/^dockerfile\.?/i, "")
        .replace(/\.dockerfile$/i, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .toLowerCase() || "default";
    const componentName =
      directoryFileCount > 1
        ? `${directoryName}-${fileVariant}`
        : directoryName;
    return {
      id: file.path,
      name: componentName,
      sourceDirectory,
      dockerfilePath: file.path,
      buildContext: sourceDirectory,
      imageRepository:
        directoryFileCount > 1
          ? `${normalizedName}-${fileVariant}`
          : normalizedName,
    };
  }

  function openDockerfilePicker(): void {
    setDockerfileSelection(draft.components.map((component) => component.id));
    setDockerfileSearch("");
    setDockerfilePickerOpen(true);
  }

  function confirmDockerfileSelection(): void {
    setDraft((current) => {
      const existingComponents = new Map(
        current.components.map((component) => [component.id, component]),
      );
      const selectedComponents = (dockerfiles.data?.items ?? [])
        .filter((file) => dockerfileSelection.includes(file.path))
        .map(
          (file) => existingComponents.get(file.path) ?? createComponent(file),
        );
      const selectedPaths = new Set(
        selectedComponents.map((component) => component.dockerfilePath),
      );
      const retainedExistingComponents = current.components.filter(
        (component) =>
          component.existing && !selectedPaths.has(component.dockerfilePath),
      );
      return {
        ...current,
        components: [...retainedExistingComponents, ...selectedComponents],
      };
    });
    setDockerfilePickerOpen(false);
  }

  function openConfirmation(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft.components.length === 0) return;
    setStep("confirm");
  }

  async function provisionCiCd(): Promise<void> {
    if (provisioning) return;
    setProvisioning(true);
    setProvisionProgress(0);
    setProvisionStep("正在提交后台任务");
    setProvisionError("");
    try {
      const queued = await apiRequest<{ jobId: string; status: "queued" }>(
        "/ci-configurations",
        {
          method: "POST",
          body: JSON.stringify({
            gitLabProjectId: project.id,
            ciExecutionMode: draft.ciExecutionMode ?? "COMPONENT_DOCKER",
            pipelineDefinitionPath: draft.pipelineDefinitionPath,
            registryConnectionId: draft.registryConnectionId || undefined,
            teamCityConnectionId: draft.teamCityConnectionId,
            releaseBranch: draft.releaseBranch,
            teamCityGroupMode: draft.teamCityGroupMode,
            teamCityGroupId:
              draft.teamCityGroupMode === "existing"
                ? draft.teamCityGroupId
                : undefined,
            teamCityGroupName:
              draft.teamCityGroupMode === "new"
                ? draft.teamCityGroupName.trim()
                : undefined,
            autoBuildEnabled: draft.autoBuildEnabled,
            runFirstBuild: draft.runFirstBuild,
            components: draft.components.map((component) => ({
              name: component.name.trim(),
              code: component.code,
              buildContext: component.buildContext,
              dockerfilePath: component.dockerfilePath,
              imageRepository: component.imageRepository.trim(),
            })),
          }),
        },
      );
      let result: CiProvisioningResult | null = null;
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const job = await apiRequest<ProvisioningJobStatus>(
          `/ci-configurations/jobs/${queued.jobId}`,
        );
        setProvisionProgress(job.progressPercent);
        setProvisionStep(job.currentStep ?? job.status);
        if (job.status === "completed" && job.result) {
          result = job.result;
          break;
        }
        if (job.status === "failed")
          throw new Error(
            job.errorMessage ?? `后台任务 ${queued.jobId} 执行失败`,
          );
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      if (!result)
        throw new Error(
          `后台任务仍在执行，请稍后查看任务 ${queued.jobId} 的状态`,
        );
      window.localStorage.removeItem(draftStorageKey);
      await onConfirmed(result);
    } catch (reason) {
      setProvisionError(
        reason instanceof Error ? reason.message : "CI/CD 配置失败，请重试",
      );
    } finally {
      setProvisioning(false);
    }
  }

  const editing = existingConfiguration.data?.configured === true;
  const existingComponentCount = draft.components.filter(
    (component) => component.existing,
  ).length;
  const newComponentCount = draft.components.length - existingComponentCount;

  if (!configurationHydrated && !existingConfiguration.isError) {
    return (
      <div
        className="drawer-mask"
        onClick={(event) => event.target === event.currentTarget && onClose()}
      >
        <aside
          aria-label="加载 CI/CD 配置"
          className="drawer-panel ci-setup-drawer"
        >
          <div className="drawer-head">
            <div>
              <strong>正在读取 CI/CD 配置…</strong>
              <span>{project.pathWithNamespace}</span>
            </div>
            <button
              aria-label="关闭"
              className="drawer-close"
              onClick={onClose}
              type="button"
            >
              <X size={18} />
            </button>
          </div>
        </aside>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="confirm-mask">
        <section aria-label="确认 CI/CD 配置" className="confirm-dialog">
          <div className="drawer-head">
            <div>
              <strong>{editing ? "确认 CI/CD 变更" : "确认 CI/CD 配置"}</strong>
              <span>请确认平台将要使用的最终参数。</span>
            </div>
            <button
              aria-label="关闭"
              className="drawer-close"
              onClick={onClose}
              type="button"
            >
              <X size={18} />
            </button>
          </div>
          <div className="confirmation-list">
            <div>
              <span>GitLab 项目</span>
              <strong>{project.pathWithNamespace}</strong>
            </div>
            <div>
              <span>发布分支</span>
              <strong>{draft.releaseBranch}</strong>
            </div>
            <div>
              <span>TeamCity</span>
              <strong>
                {selectedTeamCity
                  ? `${selectedTeamCity.name} / ${selectedTeamCity.parentProjectId}`
                  : "尚未配置 TeamCity"}
              </strong>
            </div>
            <div>
              <span>TeamCity 组</span>
              <strong>
                {draft.teamCityGroupMode === "new"
                  ? `新建：${draft.teamCityGroupName}`
                  : selectedTeamCityGroup?.name || "尚未选择"}
              </strong>
            </div>
            <div>
              <span>镜像仓库</span>
              <strong>
                {pipelineMode && selectedRegistry
                  ? `${selectedRegistry.registryUrl}/${selectedRegistry.namespace}`
                  : `${FIXED_IMAGE_REGISTRY}/${FIXED_IMAGE_NAMESPACE}`}
              </strong>
            </div>
            <div>
              <span>构建策略</span>
              <strong>
                {draft.autoBuildEnabled ? "提交后自动构建" : "仅手动构建"}
                {draft.runFirstBuild ? "，创建后立即构建" : ""}
              </strong>
            </div>
          </div>
          <div className="confirmation-components">
            <h3>
              {pipelineMode
                ? `将配置 1 条整套流水线，包含 ${draft.components.length} 个组件`
                : editing
                  ? `将更新 ${existingComponentCount} 个、添加 ${newComponentCount} 个 CI/CD 项目`
                  : `将创建 ${draft.components.length} 个 CI/CD 项目`}
            </h3>
            {draft.components.map((component) => (
              <div key={component.id}>
                <strong>{component.name}</strong>
                <span>
                  {component.dockerfilePath} · 自动执行目录{" "}
                  {component.buildContext}
                </span>
                <code>{`${FIXED_IMAGE_REGISTRY}/${FIXED_IMAGE_NAMESPACE}/${component.imageRepository}`}</code>
              </div>
            ))}
          </div>
          <div className="omp-alert neutral">
            镜像固定推送到 {FIXED_IMAGE_REGISTRY}/{FIXED_IMAGE_NAMESPACE}，Git
            拉取、镜像登录与推送参数沿用现有 TeamCity 配置模板自动生成。
          </div>
          <div className="omp-alert neutral">
            点击确认后会提交后台任务，在 TeamCity 创建或复用组、项目、VCS
            Root、构建配置和触发器；页面会持续显示执行进度。
          </div>
          {provisioning ? (
            <div className="provision-progress" aria-live="polite">
              <div>
                <strong>{provisionStep || "等待后台任务"}</strong>
                <span>{provisionProgress}%</span>
              </div>
              <progress max={100} value={provisionProgress} />
            </div>
          ) : null}
          {provisionError ? (
            <div className="error-message" role="alert">
              {provisionError}
            </div>
          ) : null}
          <div className="drawer-actions">
            <button
              className="secondary-button"
              disabled={provisioning}
              onClick={() => setStep("configure")}
              type="button"
            >
              返回修改
            </button>
            <button
              className="primary-button"
              disabled={provisioning}
              onClick={() => void provisionCiCd()}
              type="button"
            >
              {provisioning
                ? editing
                  ? `正在保存 CI/CD… ${provisionProgress}%`
                  : `正在创建 CI/CD… ${provisionProgress}%`
                : editing
                  ? "确认并保存 CI/CD"
                  : "确认并创建 CI/CD"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="drawer-mask"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside aria-label="添加 CI/CD" className="drawer-panel ci-setup-drawer">
        <div className="drawer-head">
          <div>
            <strong>{editing ? "编辑 CI/CD" : "一键添加 CI/CD"}</strong>
            <span>{project.pathWithNamespace}</span>
          </div>
          <button
            aria-label="关闭"
            className="drawer-close"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="drawer-form"
          onSubmit={(event) => openConfirmation(event)}
        >
          <div className="form-grid two-columns">
            <label>
              <span>发布分支</span>
              <select
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    releaseBranch: event.target.value,
                  }))
                }
                required
                value={repositoryRef || draft.releaseBranch}
              >
                {branches.isPending ? (
                  <option value={draft.releaseBranch}>正在读取分支…</option>
                ) : null}
                {branches.data?.items.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.default ? "（默认）" : ""}
                    {branch.protected ? "（受保护）" : ""}
                  </option>
                ))}
                {branches.isError ? (
                  <option value={draft.releaseBranch}>
                    {draft.releaseBranch}（分支读取失败）
                  </option>
                ) : null}
              </select>
            </label>
            <label>
              <span>TeamCity 实例</span>
              <select
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    teamCityConnectionId: event.target.value,
                    teamCityGroupId: "",
                  }))
                }
                value={draft.teamCityConnectionId}
              >
                {teamCityConnections.length === 0 ? (
                  <option value="">尚未配置 TeamCity</option>
                ) : null}
                {teamCityConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} / {connection.parentProjectId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>TeamCity 组</span>
              <select
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    teamCityGroupMode: event.target.value as "existing" | "new",
                  }))
                }
                value={draft.teamCityGroupMode}
              >
                <option value="new">创建新组</option>
                <option value="existing">选择已有组</option>
              </select>
            </label>
            {draft.teamCityGroupMode === "new" ? (
              <label>
                <span>新组名称</span>
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      teamCityGroupName: event.target.value,
                    }))
                  }
                  placeholder="例如：documents"
                  required
                  value={draft.teamCityGroupName}
                />
              </label>
            ) : (
              <label>
                <span>已有组</span>
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      teamCityGroupId: event.target.value,
                    }))
                  }
                  required
                  value={draft.teamCityGroupId}
                >
                  <option value="">
                    {teamCityProjects.isPending
                      ? "正在读取 TeamCity 组…"
                      : "请选择组"}
                  </option>
                  {teamCityProjects.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!pipelineMode ? (
              <div className="fixed-registry-summary">
                <span>固定镜像推送地址</span>
                <strong>
                  {FIXED_IMAGE_REGISTRY}/{FIXED_IMAGE_NAMESPACE}
                </strong>
                <small>沿用现有 TeamCity 配置，接入项目时无需修改。</small>
              </div>
            ) : null}
          </div>
          {existingConfiguration.isError ? (
            <div className="error-message" role="alert">
              现有配置读取失败，将按新增配置处理：
              {existingConfiguration.error.message}
            </div>
          ) : null}
          {!editing ? (
            <div className="draft-hint">
              当前配置会自动保存为本机草稿，下次打开可继续编辑。
            </div>
          ) : null}
          <div className="omp-alert neutral">
            <label>
              <span>构建方式</span>
              <select
                aria-label="构建方式"
                value={draft.ciExecutionMode ?? "COMPONENT_DOCKER"}
                onChange={(event) =>
                  event.target.value === "REPOSITORY_PIPELINE"
                    ? selectRepositoryPipeline()
                    : setDraft((current) => ({
                        ...current,
                        ciExecutionMode: "COMPONENT_DOCKER",
                        components: [],
                      }))
                }
              >
                <option value="COMPONENT_DOCKER">
                  原有方式：按 Dockerfile 分别构建
                </option>
                <option
                  value="REPOSITORY_PIPELINE"
                  disabled={!repositoryScan.data?.pipeline}
                >
                  仓库流水线：整套测试、构建与推送
                </option>
              </select>
            </label>
            {repositoryScan.data?.pipelineError ? (
              <p role="alert">
                delivery.yaml：{repositoryScan.data.pipelineError}
              </p>
            ) : null}
            {pipelineMode ? (
              <>
                <p>
                  读取 delivery.yaml
                  的完整组件清单，仅生成制品；不执行自动部署。
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={selectRepositoryPipeline}
                >
                  重新读取当前分支配置
                </button>
                <label>
                  <span>TCR 连接</span>
                  <select
                    aria-label="TCR 连接"
                    required
                    value={draft.registryConnectionId ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        registryConnectionId: event.target.value,
                      }))
                    }
                  >
                    <option value="">请选择已启用的 TCR 连接</option>
                    {registries.data
                      ?.filter((item) => item.enabled)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.registryUrl}/{item.namespace}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <div className="component-section-head">
            <div>
              <strong>Dockerfile 项目</strong>
              <span>
                {pipelineMode
                  ? "同一次构建使用同一提交，全部测试通过后统一推送。"
                  : "每添加一个 Dockerfile，就会创建一个独立 CI/CD 项目。"}
              </span>
            </div>
            <div className="component-section-actions">
              <span className="selection-count">
                已添加 {draft.components.length} 个
              </span>
              <button
                className="secondary-button"
                onClick={openDockerfilePicker}
                disabled={pipelineMode}
                type="button"
              >
                <Plus size={15} />
                添加 Dockerfile
              </button>
            </div>
          </div>
          <div className="component-drafts">
            {draft.components.map((component, index) => (
              <fieldset key={component.id}>
                <legend>
                  CI/CD 项目 {index + 1}
                  {component.existing ? "（已配置）" : "（新增）"}
                </legend>
                {!component.existing && !pipelineMode ? (
                  <button
                    aria-label={`取消选择 ${component.dockerfilePath}`}
                    className="component-remove"
                    onClick={() => removeComponent(component.id)}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                ) : null}
                <div className="form-grid two-columns">
                  <label>
                    <span>TeamCity 项目名称</span>
                    <input
                      onChange={(event) =>
                        updateComponent(component.id, {
                          name: event.target.value,
                        })
                      }
                      required
                      value={component.name}
                      readOnly={pipelineMode}
                    />
                  </label>
                  <label>
                    <span>Dockerfile</span>
                    <input readOnly value={component.dockerfilePath} />
                  </label>
                  <label className="full-column">
                    <span>构建上下文</span>
                    <input
                      value={component.buildContext}
                      readOnly={pipelineMode}
                      onChange={(event) =>
                        updateComponent(component.id, {
                          buildContext: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label className="full-column">
                    <span>镜像名称</span>
                    <input
                      onChange={(event) =>
                        updateComponent(component.id, {
                          imageRepository: event.target.value,
                        })
                      }
                      required
                      value={component.imageRepository}
                      readOnly={pipelineMode}
                    />
                  </label>
                </div>
              </fieldset>
            ))}
          </div>
          {draft.components.length === 0 ? (
            <div className="omp-alert neutral">
              至少选择一个 Dockerfile 后才能继续。远程镜像推送参数会沿用现有
              TeamCity 模板。
            </div>
          ) : null}
          <div className="switch-list">
            <label className="switch-row">
              <span>
                <strong>提交后自动构建</strong>
                <small>创建 TeamCity VCS Trigger。</small>
              </span>
              <input
                checked={draft.autoBuildEnabled}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    autoBuildEnabled: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
            <label className="switch-row">
              <span>
                <strong>创建后立即首次构建</strong>
                <small>默认关闭，确认配置无误后再执行。</small>
              </span>
              <input
                checked={draft.runFirstBuild}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    runFirstBuild: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
          </div>
          <div className="drawer-actions">
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={
                !draft.teamCityConnectionId ||
                draft.components.length === 0 ||
                (draft.teamCityGroupMode === "existing" &&
                  !draft.teamCityGroupId) ||
                (draft.teamCityGroupMode === "new" &&
                  !draft.teamCityGroupName.trim())
              }
              type="submit"
            >
              下一步：确认配置
            </button>
          </div>
        </form>
        {dockerfilePickerOpen ? (
          <div
            className="dockerfile-picker-mask"
            onClick={(event) =>
              event.target === event.currentTarget &&
              setDockerfilePickerOpen(false)
            }
          >
            <section
              aria-label="选择 Dockerfile"
              aria-modal="true"
              className="dockerfile-picker-dialog"
              role="dialog"
            >
              <div className="drawer-head">
                <div>
                  <strong>选择 Dockerfile</strong>
                  <span>
                    {project.pathWithNamespace} · {draft.releaseBranch}
                  </span>
                </div>
                <button
                  aria-label="关闭 Dockerfile 选择器"
                  className="drawer-close"
                  onClick={() => setDockerfilePickerOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="dockerfile-picker-body">
                {repositoryScan.data ? (
                  <div className="scan-summary">
                    检测到 {repositoryScan.data.componentSuggestions.length} 个
                    Dockerfile 组件建议、
                    {repositoryScan.data.featureFiles.length} 个技术特征文件。
                  </div>
                ) : null}
                <div className="dockerfile-picker-toolbar">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      aria-label="搜索 Dockerfile"
                      onChange={(event) =>
                        setDockerfileSearch(event.target.value)
                      }
                      placeholder="搜索目录或 Dockerfile"
                      value={dockerfileSearch}
                    />
                  </label>
                  <span>已选 {dockerfileSelection.length} 个</span>
                </div>
                <div className="dockerfile-tree">
                  {dockerfiles.isPending ? (
                    <div className="empty-inline">
                      正在扫描仓库中的 Dockerfile…
                    </div>
                  ) : null}
                  {dockerfiles.isError ? (
                    <div className="error-message">
                      {dockerfiles.error.message}
                    </div>
                  ) : null}
                  {dockerfiles.data?.items.length === 0 ? (
                    <div className="empty-inline">
                      当前分支没有检测到 Dockerfile，请先确认分支或仓库文件。
                    </div>
                  ) : null}
                  {dockerfiles.data?.items.length &&
                  visibleDockerfiles.length === 0 ? (
                    <div className="empty-inline">没有匹配的 Dockerfile。</div>
                  ) : null}
                  {dockerfileGroups.map(([directory, files]) => (
                    <details
                      className="dockerfile-tree-group"
                      key={directory}
                      open
                    >
                      <summary>
                        <span>
                          <FolderGit2 size={16} />
                          <strong>{directory}</strong>
                        </span>
                        <small>{files.length} 个文件</small>
                      </summary>
                      <div>
                        {files.map((file) => (
                          <label className="dockerfile-tree-file" key={file.id}>
                            <input
                              checked={dockerfileSelection.includes(file.path)}
                              disabled={draft.components.some(
                                (component) =>
                                  component.existing &&
                                  component.dockerfilePath === file.path,
                              )}
                              onChange={(event) =>
                                setDockerfileSelection((current) =>
                                  event.target.checked
                                    ? [...current, file.path]
                                    : current.filter((id) => id !== file.path),
                                )
                              }
                              type="checkbox"
                            />
                            <Package size={15} />
                            <span>
                              <strong>{file.name}</strong>
                              <code>{file.path}</code>
                              {repositoryScan.data?.componentSuggestions.find(
                                (suggestion) =>
                                  suggestion.dockerfilePath === file.path,
                              )?.type ? (
                                <small>
                                  推测类型：
                                  {
                                    repositoryScan.data.componentSuggestions.find(
                                      (suggestion) =>
                                        suggestion.dockerfilePath === file.path,
                                    )?.type
                                  }
                                </small>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
              <div className="dockerfile-picker-actions">
                <button
                  className="secondary-button"
                  onClick={() => setDockerfilePickerOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={dockerfileSelection.length === 0}
                  onClick={confirmDockerfileSelection}
                  type="button"
                >
                  确认选择（新增
                  {
                    dockerfileSelection.filter(
                      (path) =>
                        !draft.components.some(
                          (component) =>
                            component.existing &&
                            component.dockerfilePath === path,
                        ),
                    ).length
                  }{" "}
                  个）
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function GitLabPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [ciStatus, setCiStatus] = useState<
    "all" | "configured" | "unconfigured"
  >("all");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [ciProject, setCiProject] = useState<GitLabProject | null>(null);
  const connections = useQuery({
    queryKey: ["gitlab-connections"],
    queryFn: () => apiRequest<GitLabConnection[]>("/integrations/gitlab"),
  });
  const projects = useQuery({
    queryKey: ["gitlab-projects", search],
    queryFn: () =>
      apiRequest<GitLabProjectPage>(
        `/gitlab-projects?page=1&pageSize=100&keyword=${encodeURIComponent(search)}`,
      ),
  });
  const teamCityConnections = useQuery({
    queryKey: ["teamcity-connections"],
    queryFn: () => apiRequest<TeamCityConnection[]>("/integrations/teamcity"),
  });

  async function syncProjects(connection: GitLabConnection): Promise<void> {
    setSyncingId(connection.id);
    setMessage("");
    try {
      const result = await apiRequest<{ synced: number; unavailable: number }>(
        `/integrations/gitlab/${connection.id}/sync`,
        { method: "POST" },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gitlab-connections"] }),
        queryClient.invalidateQueries({ queryKey: ["gitlab-projects"] }),
      ]);
      setMessage(
        `同步完成：发现 ${result.synced} 个项目，${result.unavailable} 个项目已标记为不可用。`,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "GitLab 项目同步失败",
      );
    } finally {
      setSyncingId(null);
    }
  }

  const visibleProjects = (projects.data?.items ?? []).filter((project) => {
    if (ciStatus === "configured") return project.teamCityVcsRoots.length > 0;
    if (ciStatus === "unconfigured")
      return project.teamCityVcsRoots.length === 0;
    return true;
  });
  const projectGroups = Object.entries(
    visibleProjects.reduce<Record<string, GitLabProject[]>>(
      (groups, project) => {
        const group = project.namespaceName || "未分组";
        (groups[group] ??= []).push(project);
        return groups;
      },
      {},
    ),
  )
    .map(
      ([group, groupProjects]) =>
        [
          group,
          [...groupProjects].sort((left, right) => {
            const configurationOrder =
              Number(right.teamCityVcsRoots.length > 0) -
              Number(left.teamCityVcsRoots.length > 0);
            return (
              configurationOrder || left.name.localeCompare(right.name, "zh-CN")
            );
          }),
        ] as const,
    )
    .sort(([leftName, leftProjects], [rightName, rightProjects]) => {
      const configurationOrder =
        Number(
          rightProjects.some((project) => project.teamCityVcsRoots.length > 0),
        ) -
        Number(
          leftProjects.some((project) => project.teamCityVcsRoots.length > 0),
        );
      return configurationOrder || leftName.localeCompare(rightName, "zh-CN");
    });

  return (
    <section className="page-stack">
      <PageHeader
        action={
          <button
            className="primary-button"
            onClick={() => setDrawerOpen(true)}
            type="button"
          >
            <Plus size={17} />
            新增 GitLab 连接
          </button>
        }
        eyebrow="代码源 · 连接管理"
        title="GitLab 项目"
      />
      {message ? (
        <section className="omp-alert neutral">{message}</section>
      ) : null}
      <section className="panel">
        <h2>GitLab 连接</h2>
        {connections.isPending ? <p>正在加载连接…</p> : null}
        {connections.isError ? (
          <div className="error-message">{connections.error.message}</div>
        ) : null}
        {connections.data?.length === 0 ? (
          <div className="empty-state">
            <strong>尚未配置 GitLab</strong>
            <p>点击右上角“新增 GitLab 连接”填写地址和 Access Token。</p>
          </div>
        ) : null}
        {connections.data?.map((connection) => (
          <div className="connection-row" key={connection.id}>
            <div>
              <strong>{connection.name}</strong>
              <span>{connection.baseUrl}</span>
              <span>
                {connection.lastSyncAt
                  ? `上次同步：${new Date(connection.lastSyncAt).toLocaleString("zh-CN")}`
                  : "尚未同步项目"}
              </span>
            </div>
            <div className="connection-actions">
              <span
                className={`status ${connection.enabled ? "success" : "draft"}`}
              >
                {connection.enabled ? "已启用" : "已停用"}
              </span>
              <button
                className="secondary-button"
                disabled={syncingId === connection.id}
                onClick={() => void syncProjects(connection)}
                type="button"
              >
                <RefreshCw
                  className={syncingId === connection.id ? "is-spinning" : ""}
                  size={15}
                />
                {syncingId === connection.id ? "同步中…" : "同步项目"}
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="panel project-panel">
        <div className="panel-title-row">
          <div>
            <h2>项目仓库</h2>
            <span>
              {ciStatus === "all"
                ? `共 ${projects.data?.total ?? 0} 个可访问项目`
                : `筛选出 ${visibleProjects.length} 个项目，共 ${projects.data?.total ?? 0} 个`}
            </span>
          </div>
          <div className="project-filters">
            <label className="ci-status-filter">
              <span>CI/CD 状态</span>
              <select
                aria-label="CI/CD 状态"
                onChange={(event) =>
                  setCiStatus(
                    event.target.value as "all" | "configured" | "unconfigured",
                  )
                }
                value={ciStatus}
              >
                <option value="all">全部项目</option>
                <option value="configured">已配置 CI/CD</option>
                <option value="unconfigured">未配置 CI/CD</option>
              </select>
            </label>
            <label className="search-box">
              <Search size={16} />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索项目名称或完整路径"
                value={search}
              />
            </label>
          </div>
        </div>
        {projects.isPending ? <p>正在加载项目仓库…</p> : null}
        {projects.isError ? (
          <div className="error-message">{projects.error.message}</div>
        ) : null}
        {projects.data?.items.length === 0 ? (
          <div className="empty-state">
            <strong>还没有同步到项目</strong>
            <p>
              点击上方连接右侧的“同步项目”，平台将只读拉取 GitLab 项目列表。
            </p>
          </div>
        ) : null}
        {projects.data?.items.length && visibleProjects.length === 0 ? (
          <div className="empty-state compact">
            <strong>没有符合条件的项目</strong>
            <p>请切换 CI/CD 状态或调整搜索关键词。</p>
          </div>
        ) : null}
        <div className="project-groups">
          {projectGroups.map(([group, groupProjects]) => (
            <details className="project-group" key={group}>
              <summary className="project-group-head">
                <div>
                  <FolderGit2 size={17} />
                  <strong>{group}</strong>
                </div>
                <span>{groupProjects.length} 个项目</span>
              </summary>
              <div className="project-list">
                {groupProjects.map((project) => {
                  const teamCityProjects = [
                    ...new Map(
                      project.teamCityVcsRoots.map((root) => [
                        `${root.teamCityConnection.id}:${root.teamCityProjectId}`,
                        root,
                      ]),
                    ).values(),
                  ];
                  const primaryTeamCityProject = teamCityProjects[0];
                  return (
                    <article className="project-row" key={project.id}>
                      <div className="project-icon">
                        <GitBranch size={18} />
                      </div>
                      <div className="project-main">
                        <strong>{project.name}</strong>
                        <span>{project.pathWithNamespace}</span>
                      </div>
                      <div className="project-meta">
                        {primaryTeamCityProject ? (
                          <>
                            <a
                              className="status success ci-project-link"
                              href={`${primaryTeamCityProject.teamCityConnection.baseUrl.replace(/\/$/, "")}/project.html?projectId=${encodeURIComponent(primaryTeamCityProject.teamCityProjectId)}`}
                              rel="noreferrer"
                              target="_blank"
                              title={teamCityProjects
                                .map(
                                  (root) =>
                                    `${root.teamCityConnection.name} / ${root.teamCityProjectName || root.teamCityProjectId}`,
                                )
                                .join("\n")}
                            >
                              打开 CI/CD
                              {teamCityProjects.length > 1
                                ? ` (${teamCityProjects.length})`
                                : ""}
                              <ExternalLink size={12} />
                            </a>
                            <button
                              className="secondary-button ci-create-button"
                              onClick={() => setCiProject(project)}
                              type="button"
                            >
                              <Plus size={13} />
                              编辑 / 添加
                            </button>
                          </>
                        ) : (
                          <button
                            className="secondary-button ci-create-button"
                            onClick={() => setCiProject(project)}
                            type="button"
                          >
                            <Plus size={13} />
                            一键添加 CI/CD
                          </button>
                        )}
                        <span>{project.defaultBranch || "无默认分支"}</span>
                        <span>{project.visibility}</span>
                        {project.archived ? (
                          <span className="status draft">已归档</span>
                        ) : null}
                      </div>
                      <a
                        aria-label={`在 GitLab 打开 ${project.name}`}
                        className="project-link"
                        href={project.webUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink size={16} />
                      </a>
                    </article>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>
      {drawerOpen ? (
        <GitLabConnectionDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={setMessage}
        />
      ) : null}
      {ciProject ? (
        <CiCdSetupFlow
          onClose={() => setCiProject(null)}
          onConfirmed={async (result) => {
            await queryClient.invalidateQueries({
              queryKey: ["gitlab-projects"],
            });
            setMessage(
              `${ciProject.pathWithNamespace} 的 CI/CD 已配置完成：新建 ${result.createdResources} 个、复用 ${result.reusedResources} 个 TeamCity 资源。`,
            );
            setCiProject(null);
          }}
          project={ciProject}
          teamCityConnections={teamCityConnections.data ?? []}
        />
      ) : null}
    </section>
  );
}

interface TeamCityConnection {
  id: string;
  name: string;
  baseUrl: string;
  parentProjectId: string;
  verifySsl: boolean;
  enabled: boolean;
  lastTestAt: string | null;
  lastTestStatus: string | null;
}

interface TeamCityConnectionForm {
  name: string;
  baseUrl: string;
  token: string;
  parentProjectId: string;
  verifySsl: boolean;
}

function TeamCityConnectionDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (message: string) => void;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<TeamCityConnectionForm>({
    name: "",
    baseUrl: "",
    token: "",
    parentProjectId: "_Root",
    verifySsl: true,
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    let credentialId: string | undefined;
    try {
      const credential = await apiRequest<{ id: string }>("/credentials", {
        method: "POST",
        body: JSON.stringify({
          name: `${form.name} TeamCity Token`,
          type: "TEAMCITY_TOKEN",
          secret: form.token,
        }),
      });
      credentialId = credential.id;
      await apiRequest<TeamCityConnection>("/integrations/teamcity", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          tokenCredentialId: credential.id,
          parentProjectId: form.parentProjectId,
          verifySsl: form.verifySsl,
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: ["teamcity-connections"],
      });
      onCreated("TeamCity 连接已保存，Access Token 已加密存储。");
      onClose();
    } catch (reason) {
      if (credentialId) {
        await apiRequest(`/credentials/${credentialId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      setError(
        reason instanceof Error ? reason.message : "保存 TeamCity 连接失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="drawer-mask"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside aria-label="新增 TeamCity 连接" className="drawer-panel">
        <div className="drawer-head">
          <div>
            <strong>新增 TeamCity 连接</strong>
            <span>连接 TeamCity REST API，用于后续自动创建 CI 配置。</span>
          </div>
          <button
            aria-label="关闭"
            className="drawer-close"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <form className="drawer-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>连接名称</span>
            <input
              autoFocus
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="例如：公司 TeamCity"
              required
              value={form.name}
            />
          </label>
          <label>
            <span>TeamCity 地址</span>
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
              }
              placeholder="https://teamcity.example.com"
              required
              type="url"
              value={form.baseUrl}
            />
            <small>填写浏览器中访问 TeamCity 的基础地址。</small>
          </label>
          <label>
            <span>Access Token</span>
            <div className="password-field">
              <input
                autoComplete="off"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    token: event.target.value,
                  }))
                }
                placeholder="输入 TeamCity Access Token"
                required
                type={showToken ? "text" : "password"}
                value={form.token}
              />
              <button
                aria-label={showToken ? "隐藏 Token" : "显示 Token"}
                className="password-toggle"
                onClick={() => setShowToken((value) => !value)}
                type="button"
              >
                {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <small>Token 仅以 AES-256-GCM 密文保存。</small>
          </label>
          <label>
            <span>父项目 ID</span>
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  parentProjectId: event.target.value,
                }))
              }
              placeholder="_Root"
              required
              value={form.parentProjectId}
            />
            <small>新应用的 TeamCity 项目将创建在该父项目下。</small>
          </label>
          <div className="switch-list">
            <label className="switch-row">
              <span>
                <strong>验证 SSL 证书</strong>
                <small>生产环境应保持开启。</small>
              </span>
              <input
                checked={form.verifySsl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    verifySsl: event.target.checked,
                  }))
                }
                type="checkbox"
              />
            </label>
          </div>
          {error ? <div className="error-message">{error}</div> : null}
          <div className="drawer-actions">
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "保存中…" : "保存连接"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function TeamCityPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const connections = useQuery({
    queryKey: ["teamcity-connections"],
    queryFn: () => apiRequest<TeamCityConnection[]>("/integrations/teamcity"),
  });

  async function testConnection(connection: TeamCityConnection): Promise<void> {
    setTestingId(connection.id);
    setMessage("");
    try {
      const result = await apiRequest<{ version: string; buildNumber: string }>(
        `/integrations/teamcity/${connection.id}/test`,
        { method: "POST" },
      );
      await queryClient.invalidateQueries({
        queryKey: ["teamcity-connections"],
      });
      setMessage(
        `连接成功：TeamCity ${result.version}（Build ${result.buildNumber}）。`,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "TeamCity 连接测试失败",
      );
    } finally {
      setTestingId(null);
    }
  }

  async function scanVcsRoots(connection: TeamCityConnection): Promise<void> {
    setScanningId(connection.id);
    setMessage("");
    try {
      const result = await apiRequest<{
        scanned: number;
        matched: number;
        configuredProjects: number;
        unmatched: number;
      }>(`/integrations/teamcity/${connection.id}/sync-vcs-roots`, {
        method: "POST",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["teamcity-connections"] }),
        queryClient.invalidateQueries({ queryKey: ["gitlab-projects"] }),
      ]);
      setMessage(
        `扫描完成：读取 ${result.scanned} 个 VCS Root，匹配 ${result.configuredProjects} 个 GitLab 项目，${result.unmatched} 个未匹配。`,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "TeamCity CI/CD 扫描失败",
      );
    } finally {
      setScanningId(null);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        action={
          <button
            className="primary-button"
            onClick={() => setDrawerOpen(true)}
            type="button"
          >
            <Plus size={17} />
            新增 TeamCity 连接
          </button>
        }
        eyebrow="持续集成 · 连接管理"
        title="TeamCity 连接"
      />
      {message ? (
        <section className="omp-alert neutral">{message}</section>
      ) : null}
      <section className="panel">
        <h2>TeamCity 服务</h2>
        {connections.isPending ? <p>正在加载连接…</p> : null}
        {connections.isError ? (
          <div className="error-message">{connections.error.message}</div>
        ) : null}
        {connections.data?.length === 0 ? (
          <div className="empty-state">
            <strong>尚未配置 TeamCity</strong>
            <p>点击右上角“新增 TeamCity 连接”填写地址和 Access Token。</p>
          </div>
        ) : null}
        {connections.data?.map((connection) => (
          <div className="connection-row" key={connection.id}>
            <div>
              <strong>{connection.name}</strong>
              <span>{connection.baseUrl}</span>
              <span>父项目：{connection.parentProjectId}</span>
              <span>
                {connection.lastTestAt
                  ? `上次测试：${new Date(connection.lastTestAt).toLocaleString("zh-CN")}`
                  : "尚未测试连接"}
              </span>
            </div>
            <div className="connection-actions">
              <span
                className={`status ${
                  connection.lastTestStatus === "success" ? "success" : "draft"
                }`}
              >
                {connection.lastTestStatus === "success"
                  ? "连接正常"
                  : connection.enabled
                    ? "待测试"
                    : "已停用"}
              </span>
              <button
                className="secondary-button"
                disabled={testingId === connection.id}
                onClick={() => void testConnection(connection)}
                type="button"
              >
                <RefreshCw
                  className={testingId === connection.id ? "is-spinning" : ""}
                  size={15}
                />
                {testingId === connection.id ? "测试中…" : "测试连接"}
              </button>
              <button
                className="secondary-button"
                disabled={scanningId === connection.id}
                onClick={() => void scanVcsRoots(connection)}
                type="button"
              >
                <Search size={15} />
                {scanningId === connection.id ? "扫描中…" : "扫描 CI/CD"}
              </button>
            </div>
          </div>
        ))}
      </section>
      {drawerOpen ? (
        <TeamCityConnectionDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={setMessage}
        />
      ) : null}
    </section>
  );
}

type BuildStatusValue =
  "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED" | "UNKNOWN";

interface BuildRecord {
  publicationStatus?: string;
  stages?: Array<{ code: string; status: string }>;
  artifactManifestJson?: {
    reports?: Record<
      string,
      { passed: number; failed: number; skipped: number }
    >;
    images?: Array<{
      componentCode: string;
      repository: string;
      tag: string;
      digest?: string;
    }>;
  } | null;
  id: string;
  applicationId: string;
  componentId: string | null;
  teamCityBuildId: string;
  teamCityBuildNumber: string;
  branch: string;
  commitSha: string;
  status: BuildStatusValue;
  triggerType: "VCS" | "MANUAL" | "API";
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  logUrl: string | null;
  application: {
    id: string;
    name: string;
    code: string;
    gitLabProject: {
      name: string;
      pathWithNamespace: string;
      webUrl: string;
    };
    teamCityConnection: { baseUrl: string };
  };
  component: { id: string; name: string; code: string } | null;
  images: Array<{ id: string; fullName: string; digest: string | null }>;
}

interface ImageRecord {
  id: string;
  registry: string;
  namespace: string;
  repository: string;
  tag: string;
  digest: string | null;
  fullName: string;
  commitSha: string;
  buildNumber: string;
  createdAt: string;
  component: {
    id: string;
    name: string;
    application: { id: string; name: string; code: string };
  };
  build: {
    id: string;
    status: BuildStatusValue;
    branch: string;
    logUrl: string | null;
  };
}

interface RegistryVersionsResponse {
  repository: {
    registry: string;
    namespace: string;
    repository: string;
    name: string;
  };
  items: Array<{
    tag: string;
    fullName: string;
    current: boolean;
    digest: string | null;
    buildNumber: string | null;
    commitSha: string | null;
    createdAt: string | null;
    recorded: boolean;
  }>;
  total: number;
}

interface RegistryImageTag {
  imageVersionId: string | null;
  applicationId: string | null;
  tag: string;
  fullName: string;
  digest: string | null;
  buildNumber: string | null;
  commitSha: string | null;
  createdAt: string | null;
  recorded: boolean;
}

interface RegistryRepositoryRecord {
  name: string;
  namespace: string;
  repository: string;
  fullName: string;
  remoteTagCount: number;
  updatedAt: string | null;
  tags: RegistryImageTag[];
}

interface DeploymentApplicationDetails {
  id: string;
  releaseBranch: string;
  gitLabProject: {
    id: string;
    pathWithNamespace: string;
  };
}

interface ComposeFileOption {
  id: string;
  name: string;
  path: string;
}

type DeploymentComposeSource =
  "SERVER" | "OTHER_ENVIRONMENT" | "REPOSITORY" | "INLINE" | "NONE";

interface DeploymentComposeCandidate extends ComposeFileOption {
  content: string;
  source: Exclude<DeploymentComposeSource, "INLINE" | "NONE">;
  sourceDeploymentDirectoryId?: string;
  sourceEnvironment?: DeploymentEnvironmentValue;
}

interface DeploymentComposeResolution {
  source: Exclude<DeploymentComposeSource, "INLINE">;
  candidates: DeploymentComposeCandidate[];
}

const buildStatusLabels: Record<BuildStatusValue, string> = {
  QUEUED: "排队中",
  RUNNING: "构建中",
  SUCCESS: "成功",
  FAILED: "失败",
  CANCELED: "已取消",
  UNKNOWN: "未知",
};

function buildStatusClass(status: BuildStatusValue): string {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED" || status === "CANCELED") return "danger";
  if (status === "RUNNING" || status === "QUEUED") return "active";
  return "draft";
}

interface ApplicationDeploymentDirectory {
  id: string;
  serverId: string | null;
  name: string;
  path: string;
  environment: DeploymentEnvironmentValue;
  updatedAt: string;
}

type DeploymentEnvironmentValue = "PRODUCTION" | "UAT" | "TEST";

const deploymentEnvironmentTabs: Array<{
  value: DeploymentEnvironmentValue;
  label: string;
}> = [
  { value: "PRODUCTION", label: "正式环境" },
  { value: "UAT", label: "UAT 环境" },
  { value: "TEST", label: "测试环境" },
];

async function resolveDeploymentCompose({
  directories,
  environment,
  gitLabProjectId,
  releaseBranch,
  sudoPassword,
}: {
  directories: ApplicationDeploymentDirectory[];
  environment: DeploymentEnvironmentValue;
  gitLabProjectId: string;
  releaseBranch: string;
  sudoPassword?: string;
}): Promise<DeploymentComposeResolution> {
  const current = directories.find((item) => item.environment === environment);
  const others = deploymentEnvironmentTabs
    .map(({ value }) => directories.find((item) => item.environment === value))
    .filter((item): item is ApplicationDeploymentDirectory =>
      Boolean(item && item.environment !== environment),
    );

  for (const directory of [current, ...others]) {
    if (!directory?.serverId) continue;
    const candidates = await readRemoteComposeCandidates(
      directory,
      directory.environment === environment ? "SERVER" : "OTHER_ENVIRONMENT",
      sudoPassword,
    ).catch(() => []);
    if (candidates.length > 0) {
      return { source: candidates[0]!.source, candidates };
    }
  }

  const repositoryFiles = await apiRequest<{
    ref: string;
    items: ComposeFileOption[];
  }>(
    `/gitlab-projects/${gitLabProjectId}/compose-files?ref=${encodeURIComponent(releaseBranch)}`,
  ).catch(() => ({ ref: releaseBranch, items: [] }));
  const repositoryCandidates = (
    await Promise.all(
      repositoryFiles.items.map(async (file) => {
        const result = await apiRequest<{
          ref: string;
          path: string;
          content: string;
        }>(
          `/gitlab-projects/${gitLabProjectId}/compose-file?ref=${encodeURIComponent(releaseBranch)}&path=${encodeURIComponent(file.path)}`,
        ).catch(() => null);
        return result?.content.trim()
          ? ({
              ...file,
              content: result.content,
              source: "REPOSITORY",
            } satisfies DeploymentComposeCandidate)
          : null;
      }),
    )
  ).filter((item) => item !== null);
  return repositoryCandidates.length > 0
    ? { source: "REPOSITORY", candidates: repositoryCandidates }
    : { source: "NONE", candidates: [] };
}

async function readRemoteComposeCandidates(
  directory: ApplicationDeploymentDirectory,
  source: "SERVER" | "OTHER_ENVIRONMENT",
  sudoPassword?: string,
): Promise<DeploymentComposeCandidate[]> {
  if (source === "OTHER_ENVIRONMENT") {
    await apiRequest<ServerRecord>(`/servers/${directory.serverId}/check`, {
      method: "POST",
    });
  }
  const listing = await apiRequest<{ directories: string[]; files: string[] }>(
    `/servers/${directory.serverId}/directories`,
    {
      method: "POST",
      body: JSON.stringify({
        path: directory.path,
        sudoPassword: sudoPassword || undefined,
      }),
    },
  );
  const files = listing.files
    .filter((path) => /(?:^|\/)(?:compose|docker-compose)\.ya?ml$/i.test(path))
    .map((path) => ({
      id: `${directory.id}:${path}`,
      name: path.split("/").at(-1) ?? path,
      path: path.split("/").at(-1) ?? path,
    }));
  return (
    await Promise.all(
      files.map(async (file) => {
        const result = await apiRequest<{ path: string; content: string }>(
          `/servers/${directory.serverId}/compose-file`,
          {
            method: "POST",
            body: JSON.stringify({
              directoryPath: directory.path,
              fileName: file.path,
              sudoPassword: sudoPassword || undefined,
            }),
          },
        ).catch(() => null);
        return result?.content.trim()
          ? ({
              ...file,
              content: result.content,
              source,
              sourceDeploymentDirectoryId:
                source === "OTHER_ENVIRONMENT" ? directory.id : undefined,
              sourceEnvironment: directory.environment,
            } satisfies DeploymentComposeCandidate)
          : null;
      }),
    )
  ).filter((item) => item !== null);
}

interface ApplicationRecord {
  id: string;
  name: string;
  code: string;
  releaseBranch: string;
  autoBuildEnabled: boolean;
  teamCityProjectId: string | null;
  status: "CONFIGURING" | "ACTIVE" | "ERROR" | "DISABLED" | "EXTERNAL";
  updatedAt: string;
  managed: boolean;
  persisted: boolean;
  gitLabProject: {
    id: string;
    pathWithNamespace: string;
    namespaceName: string;
    webUrl: string;
  };
  teamCityConnection: { id: string; name: string; baseUrl: string };
  teamCityProjectName?: string;
  components: Array<{
    id: string;
    name: string;
    dockerfilePath: string;
    imageRepository: string;
    teamCityBuildTypeId: string | null;
  }>;
  deploymentDirectories: ApplicationDeploymentDirectory[];
  _count: { builds: number };
  builds: Array<{ id: string; status: BuildStatusValue; createdAt: string }>;
}

function ApplicationsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [directoryApplication, setDirectoryApplication] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [directoryName, setDirectoryName] = useState("");
  const [directorySelectionMode, setDirectorySelectionMode] = useState<
    "existing" | "create"
  >("existing");
  const [directoryPath, setDirectoryPath] = useState("");
  const [directoryServerId, setDirectoryServerId] = useState("");
  const [directorySudoPassword, setDirectorySudoPassword] = useState("");
  const [directoryBrowsePath, setDirectoryBrowsePath] = useState("/");
  const [directoryEnvironment, setDirectoryEnvironment] =
    useState<DeploymentEnvironmentValue>("PRODUCTION");
  const [directoryBusyId, setDirectoryBusyId] = useState<string | null>(null);
  const [importingDirectoryId, setImportingDirectoryId] = useState<
    string | null
  >(null);
  const [directoryError, setDirectoryError] = useState("");
  const applications = useQuery({
    queryKey: ["applications"],
    queryFn: () => apiRequest<ApplicationRecord[]>("/applications"),
  });
  const deploymentDirectories = useQuery({
    queryKey: [
      "application-deployment-directories",
      directoryApplication?.id,
      directoryEnvironment,
    ],
    queryFn: () =>
      apiRequest<ApplicationDeploymentDirectory[]>(
        `/applications/${directoryApplication!.id}/deployment-directories?environment=${directoryEnvironment}`,
      ),
    enabled: Boolean(directoryApplication),
  });
  const directoryServers = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiRequest<ServerRecord[]>("/servers"),
    enabled: Boolean(directoryApplication),
  });
  const remoteDirectories = useQuery({
    queryKey: ["server-directories", directoryServerId, directoryBrowsePath],
    queryFn: () =>
      apiRequest<{ directories: string[]; files: string[] }>(
        `/servers/${directoryServerId}/directories`,
        {
          method: "POST",
          body: JSON.stringify({
            path: directoryBrowsePath,
            sudoPassword: directorySudoPassword || undefined,
          }),
        },
      ),
    enabled: Boolean(directoryApplication && directoryServerId),
    retry: false,
  });
  const onlineDirectoryServers =
    directoryServers.data?.filter((server) => server.status === "ONLINE") ?? [];
  const applicationGroups = Object.entries(
    (applications.data ?? []).reduce<Record<string, ApplicationRecord[]>>(
      (groups, application) => {
        const group = application.gitLabProject.namespaceName || "未分组";
        (groups[group] ??= []).push(application);
        return groups;
      },
      {},
    ),
  ).sort(([left], [right]) => left.localeCompare(right, "zh-CN"));

  async function openDeploymentDirectories(
    application: ApplicationRecord,
  ): Promise<void> {
    setDirectoryError("");
    if (application.persisted) {
      setDirectoryApplication({ id: application.id, name: application.name });
      setDirectoryName("");
      setDirectorySelectionMode("existing");
      setDirectoryPath("");
      setDirectorySudoPassword("");
      setDirectoryServerId("");
      setDirectoryBrowsePath("/");
      setDirectoryEnvironment("PRODUCTION");
      return;
    }

    setImportingDirectoryId(application.id);
    try {
      const result = await apiRequest<{ applicationId: string }>(
        `/applications/import-existing/${application.gitLabProject.id}`,
        { method: "POST" },
      );
      await queryClient.invalidateQueries({ queryKey: ["applications"] });
      setDirectoryApplication({
        id: result.applicationId,
        name: application.name,
      });
      setDirectoryName("");
      setDirectorySelectionMode("existing");
      setDirectoryPath("");
      setDirectoryServerId("");
      setDirectorySudoPassword("");
      setDirectoryBrowsePath("/");
      setDirectoryEnvironment("PRODUCTION");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "历史项目接入失败");
    } finally {
      setImportingDirectoryId(null);
    }
  }

  async function addDeploymentDirectory(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!directoryApplication) return;
    setDirectoryBusyId("add");
    setDirectoryError("");
    try {
      await apiRequest(
        `/applications/${directoryApplication.id}/deployment-directories`,
        {
          method: "POST",
          body: JSON.stringify({
            name:
              directorySelectionMode === "create"
                ? directoryName.trim()
                : directoryPath.split("/").filter(Boolean).at(-1) || "根目录",
            parentPath: directoryPath.trim(),
            serverId: directoryServerId,
            environment: directoryEnvironment,
            createDirectory: directorySelectionMode === "create",
            sudoPassword: directorySudoPassword || undefined,
          }),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "application-deployment-directories",
            directoryApplication.id,
            directoryEnvironment,
          ],
        }),
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
      ]);
      setDirectoryName("");
      setDirectoryPath("");
      setDirectorySudoPassword("");
    } catch (reason) {
      setDirectoryError(
        reason instanceof Error ? reason.message : "部署目录保存失败",
      );
    } finally {
      setDirectoryBusyId(null);
    }
  }

  async function removeDeploymentDirectory(
    directory: ApplicationDeploymentDirectory,
  ): Promise<void> {
    if (!directoryApplication) return;
    setDirectoryBusyId(directory.id);
    setDirectoryError("");
    try {
      await apiRequest(
        `/applications/${directoryApplication.id}/deployment-directories/${directory.id}`,
        { method: "DELETE" },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            "application-deployment-directories",
            directoryApplication.id,
            directoryEnvironment,
          ],
        }),
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
      ]);
    } catch (reason) {
      setDirectoryError(
        reason instanceof Error ? reason.message : "部署目录移除失败",
      );
    } finally {
      setDirectoryBusyId(null);
    }
  }

  async function checkConfiguration(
    application: ApplicationRecord,
  ): Promise<void> {
    setCheckingId(application.id);
    setMessage("");
    try {
      const result = await apiRequest<{
        checked: number;
        active: number;
        missing: number;
      }>(`/applications/${application.id}/check-configuration`, {
        method: "POST",
      });
      setMessage(
        `${application.name} 检查完成：${result.active}/${result.checked} 个资源正常，${result.missing} 个缺失。`,
      );
      await queryClient.invalidateQueries({ queryKey: ["applications"] });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "配置检查失败");
    } finally {
      setCheckingId(null);
    }
  }

  async function triggerApplication(
    application: ApplicationRecord,
  ): Promise<void> {
    if (!window.confirm(`确认构建 ${application.name} 的全部启用组件？`))
      return;
    setTriggeringId(application.id);
    setMessage("");
    try {
      const result = await apiRequest<{
        builds: Array<{ teamCityBuildId: string }>;
      }>("/builds/trigger", {
        method: "POST",
        body: JSON.stringify({ applicationId: application.id }),
      });
      setMessage(
        `${application.name} 已排队 ${result.builds.length} 个构建：${result.builds.map((build) => `#${build.teamCityBuildId}`).join("、")}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["builds"] });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "构建触发失败");
    } finally {
      setTriggeringId(null);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        action={
          <Link className="primary-button" to="/gitlab">
            <Plus size={16} /> 接入项目
          </Link>
        }
        eyebrow="项目接入 · 应用管理"
        title="应用接入"
      />
      {message ? (
        <section className="omp-alert neutral">{message}</section>
      ) : null}
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>应用项目</h2>
            <span>共 {applications.data?.length ?? 0} 个项目</span>
          </div>
        </div>
        {applications.isPending ? <p>正在加载应用…</p> : null}
        {applications.isError ? (
          <div className="error-message">{applications.error.message}</div>
        ) : null}
        {applications.data?.length === 0 ? (
          <div className="empty-state">
            <strong>暂无已接入应用</strong>
            <p>前往 GitLab 项目选择 Dockerfile 并创建 CI/CD。</p>
          </div>
        ) : null}
        <div className="project-groups">
          {applicationGroups.map(([group, groupApplications]) => (
            <details className="project-group" key={group}>
              <summary className="project-group-head">
                <div>
                  <FolderGit2 size={17} />
                  <strong>{group}</strong>
                </div>
                <span>{groupApplications.length} 个项目</span>
              </summary>
              <div className="application-grid">
                {groupApplications.map((application) => (
                  <article className="application-card" key={application.id}>
                    <div className="application-card-head">
                      <div>
                        <strong>{application.name}</strong>
                        <span>
                          {application.gitLabProject.pathWithNamespace}
                        </span>
                      </div>
                      <span
                        className={`status ${
                          application.status === "ACTIVE" ||
                          application.status === "EXTERNAL"
                            ? "success"
                            : application.status === "ERROR"
                              ? "danger"
                              : "draft"
                        }`}
                      >
                        {application.status === "ACTIVE"
                          ? "已接入"
                          : application.status === "EXTERNAL"
                            ? "已识别 CI/CD"
                            : application.status === "ERROR"
                              ? "配置异常"
                              : application.status === "DISABLED"
                                ? "已停用"
                                : "配置中"}
                      </span>
                    </div>
                    <div className="application-summary">
                      <span>分支：{application.releaseBranch}</span>
                      {application.managed ? (
                        <>
                          <span>组件：{application.components.length}</span>
                          <span>
                            部署目录：{application.deploymentDirectories.length}
                          </span>
                          <span>构建：{application._count.builds}</span>
                          <span>
                            自动触发：
                            {application.autoBuildEnabled ? "开启" : "关闭"}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            TeamCity：
                            {application.teamCityProjectName ||
                              application.teamCityProjectId}
                          </span>
                          <span>来源：现有 CI/CD 配置</span>
                        </>
                      )}
                    </div>
                    <div className="application-components">
                      {application.components.map((component) => (
                        <div key={component.id}>
                          <strong>{component.name}</strong>
                          <code>{component.dockerfilePath}</code>
                          <span>{component.imageRepository}</span>
                        </div>
                      ))}
                    </div>
                    <div className="delivery-record-actions application-actions">
                      <a
                        className="secondary-button"
                        href={application.gitLabProject.webUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        GitLab <ExternalLink size={13} />
                      </a>
                      {application.teamCityProjectId ? (
                        <a
                          className="secondary-button"
                          href={`${application.teamCityConnection.baseUrl.replace(/\/$/, "")}/project.html?projectId=${encodeURIComponent(application.teamCityProjectId)}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          TeamCity <ExternalLink size={13} />
                        </a>
                      ) : null}
                      <button
                        className="secondary-button"
                        disabled={importingDirectoryId === application.id}
                        onClick={() =>
                          void openDeploymentDirectories(application)
                        }
                        type="button"
                      >
                        <FolderGit2 size={13} />
                        {importingDirectoryId === application.id
                          ? "接入中…"
                          : "部署目录"}
                      </button>
                      {application.managed ? (
                        <button
                          className="secondary-button"
                          disabled={checkingId === application.id}
                          onClick={() => void checkConfiguration(application)}
                          type="button"
                        >
                          <Search size={13} />
                          {checkingId === application.id
                            ? "检查中…"
                            : "检查配置"}
                        </button>
                      ) : null}
                      {application.managed ? (
                        <button
                          className="primary-button"
                          disabled={
                            triggeringId === application.id ||
                            application.status !== "ACTIVE"
                          }
                          onClick={() => void triggerApplication(application)}
                          type="button"
                        >
                          <Hammer size={13} />
                          {triggeringId === application.id
                            ? "排队中…"
                            : "构建全部"}
                        </button>
                      ) : (
                        <Link className="primary-button" to="/gitlab">
                          完善应用接入
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
      {directoryApplication ? (
        <div
          className="drawer-mask"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            setDirectorySudoPassword("");
            setDirectoryApplication(null);
          }}
          role="presentation"
        >
          <aside
            aria-modal="true"
            className="drawer-panel directory-drawer"
            role="dialog"
          >
            <div className="drawer-head">
              <div>
                <strong>项目部署目录</strong>
                <span>{directoryApplication.name} · 从在线服务器选择目录</span>
              </div>
              <button
                aria-label="关闭"
                className="drawer-close"
                onClick={() => {
                  setDirectorySudoPassword("");
                  setDirectoryApplication(null);
                }}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="directory-content">
              <div
                aria-label="部署环境"
                className="deployment-environment-tabs"
                role="tablist"
              >
                {deploymentEnvironmentTabs.map((environment) => (
                  <button
                    aria-selected={directoryEnvironment === environment.value}
                    className={
                      directoryEnvironment === environment.value
                        ? "is-active"
                        : ""
                    }
                    key={environment.value}
                    onClick={() => {
                      setDirectoryEnvironment(environment.value);
                      setDirectoryName("");
                      setDirectorySelectionMode("existing");
                      setDirectoryPath("");
                      setDirectoryServerId("");
                      setDirectorySudoPassword("");
                      setDirectoryBrowsePath("/");
                    }}
                    role="tab"
                    type="button"
                  >
                    {environment.label}
                  </button>
                ))}
              </div>
              <section>
                <div className="directory-section-head">
                  <div>
                    <strong>已配置目录</strong>
                    <span>部署时仅显示当前项目的目录</span>
                  </div>
                </div>
                <div className="allowed-directory-list">
                  {deploymentDirectories.data?.map((directory) => {
                    const configuredServer = directoryServers.data?.find(
                      (server) => server.id === directory.serverId,
                    );
                    return (
                      <div className="allowed-directory-row" key={directory.id}>
                        <div>
                          <strong>{directory.name}</strong>
                          <code>{directory.path}</code>
                          <span
                            className={`configured-directory-server${configuredServer ? "" : " is-missing"}`}
                          >
                            <Server size={13} />
                            {configuredServer ? (
                              <>
                                {configuredServer.name}
                                {configuredServer.sshAlias
                                  ? ` · ${configuredServer.sshAlias}`
                                  : ""}
                                {configuredServer.host
                                  ? ` · ${configuredServer.host}`
                                  : ""}
                              </>
                            ) : directory.serverId ? (
                              "服务器信息暂不可用"
                            ) : (
                              "历史配置 · 未关联服务器"
                            )}
                          </span>
                        </div>
                        <button
                          aria-label="移除部署目录"
                          className="drawer-close"
                          disabled={directoryBusyId === directory.id}
                          onClick={() =>
                            void removeDeploymentDirectory(directory)
                          }
                          type="button"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                  {!deploymentDirectories.isPending &&
                  (deploymentDirectories.data?.length ?? 0) === 0 ? (
                    <div className="empty-state compact">
                      尚未配置项目部署目录。
                    </div>
                  ) : null}
                </div>
              </section>
              {!deploymentDirectories.isPending &&
              (deploymentDirectories.data?.length ?? 0) === 0 ? (
                <form
                  className="drawer-form directory-setup-form"
                  onSubmit={(event) => void addDeploymentDirectory(event)}
                >
                  <label>
                    <span>部署服务器</span>
                    <select
                      required
                      value={directoryServerId}
                      onChange={(event) => {
                        setDirectoryServerId(event.target.value);
                        setDirectoryBrowsePath("/");
                        setDirectoryPath("");
                        setDirectorySelectionMode("existing");
                        setDirectorySudoPassword("");
                      }}
                    >
                      <option value="">请选择在线服务器</option>
                      {onlineDirectoryServers.map((server) => (
                        <option key={server.id} value={server.id}>
                          {server.name}
                          {server.host ? ` · ${server.host}` : ""}
                        </option>
                      ))}
                    </select>
                    {directoryServers.isPending ? (
                      <small>正在读取在线服务器…</small>
                    ) : onlineDirectoryServers.length === 0 ? (
                      <small>当前没有在线部署服务器。</small>
                    ) : (
                      <small>选择服务器后会通过 SSH 读取其目录。</small>
                    )}
                  </label>
                  {directoryServerId ? (
                    <label>
                      <span>sudo 提权密码（按需）</span>
                      <div className="sudo-password-row">
                        <input
                          autoComplete="new-password"
                          maxLength={1024}
                          placeholder="当前 SSH 用户权限不足时填写"
                          type="password"
                          value={directorySudoPassword}
                          onChange={(event) =>
                            setDirectorySudoPassword(event.target.value)
                          }
                        />
                        <button
                          className="secondary-button"
                          disabled={!directorySudoPassword}
                          onClick={() => void remoteDirectories.refetch()}
                          type="button"
                        >
                          使用 sudo 重新读取
                        </button>
                      </div>
                      <small>密码仅用于本次远程操作，不会保存。</small>
                    </label>
                  ) : null}
                  {directoryServerId ? (
                    <div
                      aria-label="目录使用方式"
                      className="directory-mode-switch"
                      role="group"
                    >
                      <button
                        className={
                          directorySelectionMode === "existing"
                            ? "is-active"
                            : ""
                        }
                        onClick={() => setDirectorySelectionMode("existing")}
                        type="button"
                      >
                        直接使用当前目录
                      </button>
                      <button
                        className={
                          directorySelectionMode === "create" ? "is-active" : ""
                        }
                        onClick={() => setDirectorySelectionMode("create")}
                        type="button"
                      >
                        在当前目录下新建
                      </button>
                    </div>
                  ) : null}
                  {directoryServerId ? (
                    <section className="remote-browser">
                      <div className="directory-section-head">
                        <div>
                          <strong>服务器目录</strong>
                          <span>进入目标父目录后选择当前路径</span>
                        </div>
                        <button
                          className="secondary-button"
                          disabled={directoryBrowsePath === "/"}
                          onClick={() => {
                            const parent = directoryBrowsePath
                              .split("/")
                              .slice(0, -1)
                              .join("/");
                            setDirectoryBrowsePath(parent || "/");
                          }}
                          type="button"
                        >
                          <ArrowUp size={14} /> 上级
                        </button>
                      </div>
                      <code className="current-remote-path">
                        {directoryBrowsePath}
                      </code>
                      {remoteDirectories.isPending ? (
                        <p>正在读取目录…</p>
                      ) : null}
                      {remoteDirectories.isError ? (
                        <div className="error-message">
                          {remoteDirectories.error.message}
                        </div>
                      ) : null}
                      <div className="remote-directory-list">
                        {remoteDirectories.data?.directories.map(
                          (directory) => (
                            <button
                              key={directory}
                              onClick={() => setDirectoryBrowsePath(directory)}
                              type="button"
                            >
                              <FolderGit2 size={15} />
                              <span>
                                {directory.split("/").filter(Boolean).at(-1)}
                              </span>
                            </button>
                          ),
                        )}
                        {remoteDirectories.data?.files?.map((file) => (
                          <div className="remote-file-entry" key={file}>
                            <FileText size={15} />
                            <span>
                              {file.split("/").filter(Boolean).at(-1)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {!remoteDirectories.isPending &&
                      !remoteDirectories.isError &&
                      remoteDirectories.data?.directories.length === 0 &&
                      (remoteDirectories.data.files?.length ?? 0) === 0 ? (
                        <div className="empty-state compact">
                          当前目录为空。
                        </div>
                      ) : null}
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setDirectoryPath(directoryBrowsePath);
                        }}
                        type="button"
                      >
                        {directorySelectionMode === "create"
                          ? "选择为父目录"
                          : "选择当前目录"}
                      </button>
                    </section>
                  ) : null}
                  <div
                    className={`directory-selection-fields${directorySelectionMode === "existing" ? " is-existing" : ""}`}
                  >
                    <div className="directory-parent-path-field">
                      <span>
                        {directorySelectionMode === "create"
                          ? "父目录路径"
                          : "部署目录"}
                      </span>
                      <code className={directoryPath ? "" : "is-empty"}>
                        {directoryPath || "请先从服务器目录中选择"}
                      </code>
                    </div>
                    {directorySelectionMode === "create" ? (
                      <label>
                        <span>新建目录名称</span>
                        <input
                          maxLength={128}
                          pattern="[^/]+"
                          placeholder="例如：delivery-hub"
                          required
                          value={directoryName}
                          onChange={(event) =>
                            setDirectoryName(event.target.value)
                          }
                        />
                        {directoryPath && directoryName.trim() ? (
                          <small>
                            将在服务器上创建：
                            <code>{`${directoryPath === "/" ? "" : directoryPath}/${directoryName.trim()}`}</code>
                          </small>
                        ) : null}
                      </label>
                    ) : null}
                  </div>
                  {directoryError ? (
                    <div className="error-message">{directoryError}</div>
                  ) : null}
                  <button
                    className="primary-button directory-submit-button"
                    disabled={
                      directoryBusyId === "add" ||
                      !directoryServerId ||
                      !directoryPath ||
                      (directorySelectionMode === "create" &&
                        !directoryName.trim())
                    }
                    type="submit"
                  >
                    <Check size={15} />
                    {directoryBusyId === "add"
                      ? directorySelectionMode === "create"
                        ? "创建中…"
                        : "确认中…"
                      : directorySelectionMode === "create"
                        ? "创建并确认"
                        : "确认使用此目录"}
                  </button>
                </form>
              ) : null}
              {(deploymentDirectories.data?.length ?? 0) > 0 ? (
                <p className="directory-configured-hint">
                  当前环境已配置目录。如需更换，请先删除上方目录。
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function BuildsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | BuildStatusValue>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [syncing, setSyncing] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const builds = useQuery({
    queryKey: ["builds", page, pageSize, status, search],
    queryFn: () =>
      apiRequest<{ items: BuildRecord[]; total: number }>(
        `/builds?page=${page}&pageSize=${pageSize}${status === "all" ? "" : `&status=${status}`}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
  });
  const visibleBuilds = builds.data?.items ?? [];
  const totalPages = Math.max(
    1,
    Math.ceil((builds.data?.total ?? 0) / pageSize),
  );

  async function syncBuilds(): Promise<void> {
    setSyncing(true);
    setMessage("");
    try {
      const result = await apiRequest<{ discovered: number; updated: number }>(
        "/builds/sync",
        { method: "POST" },
      );
      await queryClient.invalidateQueries({ queryKey: ["builds"] });
      setMessage(
        `同步完成：发现 ${result.discovered} 条新构建，更新 ${result.updated} 条记录。`,
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "构建同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function triggerBuild(build: BuildRecord): Promise<void> {
    if (
      !build.componentId &&
      (!build.publicationStatus || build.publicationStatus === "NOT_APPLICABLE")
    )
      return;
    if (
      !window.confirm(
        `确认重新构建 ${build.application.name} / ${build.component?.name ?? "组件"}？`,
      )
    )
      return;
    setTriggeringId(build.id);
    setMessage("");
    try {
      const result = await apiRequest<{
        builds: Array<{ teamCityBuildId: string }>;
      }>("/builds/trigger", {
        method: "POST",
        body: JSON.stringify({
          applicationId: build.applicationId,
          componentId: build.componentId ?? undefined,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["builds"] });
      setMessage(
        `构建已进入 TeamCity 队列：#${result.builds[0]?.teamCityBuildId}`,
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "构建触发失败");
    } finally {
      setTriggeringId(null);
    }
  }

  async function cancelBuild(build: BuildRecord): Promise<void> {
    if (
      !window.confirm(
        `确认取消 Build #${build.teamCityBuildNumber || build.teamCityBuildId}？`,
      )
    )
      return;
    setCancelingId(build.id);
    setMessage("");
    try {
      const result = await apiRequest<{
        canceled: boolean;
        status: BuildStatusValue;
      }>(`/builds/${build.id}/cancel`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({ queryKey: ["builds"] });
      setMessage(
        result.canceled
          ? "构建已取消。"
          : "TeamCity 中该构建已结束，状态已同步。",
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "取消构建失败");
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        action={
          <button
            className="primary-button"
            disabled={syncing}
            onClick={() => void syncBuilds()}
            type="button"
          >
            <RefreshCw className={syncing ? "is-spinning" : ""} size={16} />
            {syncing ? "同步中…" : "同步 TeamCity"}
          </button>
        }
        eyebrow="构建交付 · TeamCity"
        title="构建记录"
      />
      {message ? (
        <section className="omp-alert neutral">{message}</section>
      ) : null}
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>最近构建</h2>
            <span>共 {builds.data?.total ?? 0} 条构建记录</span>
          </div>
          <div className="build-list-filters">
            <label className="search-box">
              <Search size={15} />
              <input
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="搜索 GitLab 仓库或 CI/CD 名称"
                value={searchInput}
              />
            </label>
            <label className="ci-status-filter">
              <span>构建状态</span>
              <select
                onChange={(event) => {
                  setStatus(event.target.value as "all" | BuildStatusValue);
                  setPage(1);
                }}
                value={status}
              >
                <option value="all">全部状态</option>
                {Object.entries(buildStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {builds.isPending ? <p>正在加载构建记录…</p> : null}
        {builds.isError ? (
          <div className="error-message">{builds.error.message}</div>
        ) : null}
        {!builds.isPending && visibleBuilds.length === 0 ? (
          <div className="empty-state compact">
            <strong>暂无构建记录</strong>
            <p>创建 CI/CD 后可手动触发，或等待 GitLab 推送自动触发。</p>
          </div>
        ) : null}
        <div className="delivery-record-list">
          {visibleBuilds.map((build) => (
            <article className="delivery-record" key={build.id}>
              <div className="delivery-record-main">
                <div>
                  <strong>
                    {build.application.gitLabProject.pathWithNamespace}
                  </strong>
                  <span>
                    {build.component?.name ??
                      (build.publicationStatus &&
                      build.publicationStatus !== "NOT_APPLICABLE"
                        ? "整套仓库流水线"
                        : "未关联组件")}
                  </span>
                </div>
                <span className={`status ${buildStatusClass(build.status)}`}>
                  {buildStatusLabels[build.status]}
                </span>
              </div>
              <div className="delivery-record-meta">
                <span>
                  Build #{build.teamCityBuildNumber || build.teamCityBuildId}
                </span>
                <span>{build.branch || "默认分支"}</span>
                <code>
                  {build.commitSha === "pending"
                    ? "等待 Commit"
                    : build.commitSha.slice(0, 10)}
                </code>
                <span>
                  {build.durationSeconds === null
                    ? "尚未完成"
                    : `${build.durationSeconds}s`}
                </span>
                <span>
                  {new Date(
                    build.startedAt ?? build.finishedAt ?? Date.now(),
                  ).toLocaleString("zh-CN")}
                </span>
              </div>
              {build.publicationStatus &&
              build.publicationStatus !== "NOT_APPLICABLE" ? (
                <details className="omp-alert neutral">
                  <summary>
                    制品：
                    {{
                      VERIFIED: "整套已校验",
                      PARTIAL: "部分推送，整套不可用",
                      PENDING_VERIFY: "已推送，等待校验",
                      PENDING: "等待结果",
                      NONE: "尚未推送",
                    }[build.publicationStatus] ?? build.publicationStatus}{" "}
                    · {build.images.length} 个已登记镜像
                  </summary>
                  <p>
                    {build.stages
                      ?.map((stage) => `${stage.code}: ${stage.status}`)
                      .join(" → ")}
                  </p>
                  {Object.entries(
                    build.artifactManifestJson?.reports ?? {},
                  ).map(([name, report]) => (
                    <p key={name}>
                      {name}：通过 {report.passed}，失败 {report.failed}，跳过{" "}
                      {report.skipped}
                    </p>
                  ))}
                  {build.artifactManifestJson?.images?.map((image) => (
                    <p key={image.componentCode}>
                      <code>
                        {image.repository}:{image.tag}
                      </code>
                      <br />
                      <small>{image.digest ?? "尚无远端摘要"}</small>
                    </p>
                  ))}
                </details>
              ) : null}
              <div className="delivery-record-actions">
                {build.logUrl ? (
                  <a
                    className="secondary-button"
                    href={build.logUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    TeamCity 日志 <ExternalLink size={13} />
                  </a>
                ) : null}
                {build.componentId ||
                (build.publicationStatus &&
                  build.publicationStatus !== "NOT_APPLICABLE") ? (
                  <button
                    className="secondary-button"
                    disabled={triggeringId === build.id}
                    onClick={() => void triggerBuild(build)}
                    type="button"
                  >
                    <Hammer size={13} />
                    {triggeringId === build.id ? "触发中…" : "重新构建"}
                  </button>
                ) : null}
                {["QUEUED", "RUNNING"].includes(build.status) ? (
                  <button
                    className="secondary-button"
                    disabled={cancelingId === build.id}
                    onClick={() => void cancelBuild(build)}
                    type="button"
                  >
                    {cancelingId === build.id ? "取消中…" : "取消构建"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        {(builds.data?.total ?? 0) > 0 ? (
          <div className="build-pagination">
            <span>
              第 {page} / {totalPages} 页，共 {builds.data?.total ?? 0} 条
            </span>
            <label className="ci-status-filter">
              <span>每页</span>
              <select
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                value={pageSize}
              >
                {[10, 20, 50].map((size) => (
                  <option key={size} value={size}>
                    {size} 条
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={page <= 1 || builds.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              上一页
            </button>
            <button
              className="secondary-button"
              disabled={page >= totalPages || builds.isFetching}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              type="button"
            >
              下一页
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function ImagesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tagPage, setTagPage] = useState(1);
  const [tagPageSize, setTagPageSize] = useState(10);
  const [selectedRepository, setSelectedRepository] =
    useState<RegistryRepositoryRecord | null>(null);
  const [deployVersion, setDeployVersion] = useState<RegistryImageTag | null>(
    null,
  );
  const [selectedServerId, setSelectedServerId] = useState("");
  const [selectedDirectoryId, setSelectedDirectoryId] = useState("");
  const [deploymentEnvironment, setDeploymentEnvironment] =
    useState<DeploymentEnvironmentValue>("PRODUCTION");
  const [selectedComposePath, setSelectedComposePath] = useState("");
  const [composeServices, setComposeServices] = useState<
    ComposeServiceOption[]
  >([]);
  const [analyzedComposeContent, setAnalyzedComposeContent] = useState("");
  const [manualComposeActive, setManualComposeActive] = useState(false);
  const [manualComposeFileName, setManualComposeFileName] =
    useState("compose.yml");
  const [manualComposeContent, setManualComposeContent] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [deploymentSudoPassword, setDeploymentSudoPassword] = useState("");
  const [showDeploymentSudoPassword, setShowDeploymentSudoPassword] =
    useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState("");
  const [deploymentError, setDeploymentError] = useState("");
  const [versionCopyStatus, setVersionCopyStatus] = useState<{
    tag: string;
    success: boolean;
  } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const repositories = useQuery({
    queryKey: ["registry-catalog", page, pageSize, search],
    queryFn: () =>
      apiRequest<{
        items: RegistryRepositoryRecord[];
        total: number;
        page: number;
        pageSize: number;
      }>(
        `/images/registry/catalog?page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
    refetchInterval: 30_000,
    retry: false,
  });
  const deployServers = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiRequest<ServerRecord[]>("/servers"),
    enabled: Boolean(deployVersion),
  });
  const deploymentApplication = useQuery({
    queryKey: ["deployment-application", deployVersion?.applicationId],
    queryFn: () =>
      apiRequest<DeploymentApplicationDetails>(
        `/applications/${deployVersion!.applicationId}`,
      ),
    enabled: Boolean(deployVersion?.applicationId),
  });
  const deployDirectories = useQuery({
    queryKey: [
      "application-deployment-directories",
      deployVersion?.applicationId,
    ],
    queryFn: () =>
      apiRequest<ApplicationDeploymentDirectory[]>(
        `/applications/${deployVersion!.applicationId}/deployment-directories`,
      ),
    enabled: Boolean(deployVersion?.applicationId),
  });
  const composeDeploymentDirectory = deployDirectories.data?.find(
    (directory) => directory.environment === deploymentEnvironment,
  );
  const deploymentServerCheck = useQuery({
    queryKey: [
      "deployment-server-check",
      deployVersion?.imageVersionId,
      composeDeploymentDirectory?.serverId,
    ],
    queryFn: () =>
      apiRequest<ServerRecord>(
        `/servers/${composeDeploymentDirectory!.serverId}/check`,
        { method: "POST" },
      ),
    enabled: Boolean(deployVersion && composeDeploymentDirectory?.serverId),
    retry: false,
  });
  const composeResolution = useQuery({
    queryKey: [
      "deployment-compose-resolution",
      deployVersion?.applicationId,
      deploymentEnvironment,
      deployDirectories.data?.map((item) => [
        item.id,
        item.serverId,
        item.path,
        item.updatedAt,
      ]),
      deploymentApplication.data?.releaseBranch,
      deploymentSudoPassword,
    ],
    queryFn: () =>
      resolveDeploymentCompose({
        directories: deployDirectories.data!,
        environment: deploymentEnvironment,
        gitLabProjectId: deploymentApplication.data!.gitLabProject.id,
        releaseBranch: deploymentApplication.data!.releaseBranch,
        sudoPassword: deploymentSudoPassword || undefined,
      }),
    enabled: Boolean(
      deployVersion &&
      deployDirectories.data &&
      deploymentServerCheck.isSuccess &&
      deploymentApplication.data?.gitLabProject.id,
    ),
    retry: false,
  });
  const effectiveComposeFiles = manualComposeActive
    ? [
        {
          id: "inline-compose",
          name: manualComposeFileName,
          path: manualComposeFileName,
          content: manualComposeContent,
          source: "REPOSITORY" as const,
        },
      ]
    : (composeResolution.data?.candidates ?? []);
  const selectedComposeCandidate = effectiveComposeFiles.find(
    (file) => file.path === selectedComposePath,
  );
  const composeFileSource: DeploymentComposeSource = manualComposeActive
    ? "INLINE"
    : (composeResolution.data?.source ?? "NONE");
  const isExistingDeployment = composeFileSource === "SERVER";
  const currentComposeContent = manualComposeActive
    ? manualComposeContent
    : (selectedComposeCandidate?.content ?? "");
  const composeAnalysisReady =
    Boolean(currentComposeContent) &&
    analyzedComposeContent === currentComposeContent;
  const requiresManualServiceName =
    composeAnalysisReady && composeServices.length === 0;
  const requiresServiceSelection =
    composeAnalysisReady && composeServices.length > 1;

  useEffect(() => {
    let active = true;
    setAnalyzedComposeContent("");
    setComposeServices([]);
    if (!currentComposeContent) return () => undefined;
    void analyzeComposeContent(currentComposeContent).then((services) => {
      if (!active) return;
      setComposeServices(services);
      setAnalyzedComposeContent(currentComposeContent);
    });
    return () => {
      active = false;
    };
  }, [currentComposeContent]);

  useEffect(() => {
    if (!composeAnalysisReady) return;
    if (composeServices.length === 0) {
      setServiceName("");
      return;
    }
    if (composeServices.length === 1) {
      setServiceName(composeServices[0]?.name ?? "");
      return;
    }
    if (composeServices.length > 1) {
      setServiceName((current) =>
        composeServices.some((service) => service.name === current)
          ? current
          : "",
      );
    }
  }, [composeAnalysisReady, composeServices]);

  const totalPages = Math.max(
    1,
    Math.ceil((repositories.data?.total ?? 0) / pageSize),
  );
  const tagTotalPages = Math.max(
    1,
    Math.ceil((selectedRepository?.tags.length ?? 0) / tagPageSize),
  );
  const visibleTags = (selectedRepository?.tags ?? []).slice(
    (tagPage - 1) * tagPageSize,
    tagPage * tagPageSize,
  );
  const selectedDeploymentDirectory = deployDirectories.data?.find(
    (directory) => directory.environment === deploymentEnvironment,
  );
  const selectedDeploymentServer =
    deploymentServerCheck.data?.id === selectedDeploymentDirectory?.serverId
      ? deploymentServerCheck.data
      : deployServers.data?.find(
          (server) => server.id === selectedDeploymentDirectory?.serverId,
        );

  useEffect(() => {
    const directories = deployDirectories.data ?? [];
    const directory = directories.find(
      (item) => item.environment === deploymentEnvironment,
    );
    setSelectedDirectoryId(directory?.id ?? "");
    setSelectedServerId(directory?.serverId ?? "");
  }, [deployDirectories.data, deploymentEnvironment]);

  useEffect(() => {
    const directories = deployDirectories.data ?? [];
    if (directories.length === 0) return;
    setDeploymentEnvironment((current) => {
      const currentDirectory = directories.find(
        (directory) => directory.environment === current,
      );
      if (currentDirectory?.serverId) return current;
      return (
        directories.find((directory) => directory.serverId)?.environment ??
        currentDirectory?.environment ??
        directories[0]?.environment ??
        current
      );
    });
  }, [deployDirectories.data]);

  useEffect(() => {
    const items = effectiveComposeFiles;
    setSelectedComposePath((current) => {
      if (items.length === 1) return items[0]?.path ?? "";
      return items.some((item) => item.path === current) ? current : "";
    });
  }, [composeResolution.data, manualComposeActive, manualComposeFileName]);

  function openDeployment(version: RegistryImageTag): void {
    if (!version.imageVersionId) return;
    setDeployVersion(version);
    setSelectedServerId("");
    setSelectedDirectoryId("");
    setDeploymentEnvironment("PRODUCTION");
    setSelectedComposePath("");
    setManualComposeActive(false);
    setManualComposeFileName("compose.yml");
    setManualComposeContent("");
    setServiceName("");
    setDeploymentSudoPassword("");
    setShowDeploymentSudoPassword(false);
    setDeploymentError("");
  }

  async function copyImageVersion(tag: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(tag);
      setVersionCopyStatus({ tag, success: true });
    } catch {
      setVersionCopyStatus({ tag, success: false });
    }
    window.setTimeout(() => {
      setVersionCopyStatus((current) =>
        current?.tag === tag ? null : current,
      );
    }, 1_800);
  }

  async function uploadComposeFile(file: File): Promise<void> {
    if (file.size > 1024 * 1024) {
      setDeploymentError("Docker Compose 文件不能超过 1 MiB");
      return;
    }
    const content = await file.text();
    if (!content.trim()) {
      setDeploymentError("上传的 Docker Compose 文件不能为空");
      return;
    }
    const fileName = /^(?:compose|docker-compose)\.ya?ml$/i.test(file.name)
      ? file.name
      : "compose.yml";
    setManualComposeFileName(fileName);
    setManualComposeContent(content);
    setManualComposeActive(true);
    setSelectedComposePath(fileName);
    setDeploymentError("");
  }

  async function deployImage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!deployVersion?.imageVersionId) return;
    setDeploying(true);
    setDeploymentError("");
    try {
      const deployment = await apiRequest<{
        id: string;
        status: "SUCCESS" | "FAILED";
      }>("/deployments", {
        method: "POST",
        body: JSON.stringify({
          imageVersionId: deployVersion.imageVersionId,
          serverId: selectedServerId,
          deploymentDirectoryId: selectedDirectoryId,
          serviceName,
          composeFilePath: selectedComposePath,
          composeFileSource,
          sourceDeploymentDirectoryId:
            selectedComposeCandidate?.sourceDeploymentDirectoryId,
          composeFileContent:
            composeFileSource === "INLINE" ? manualComposeContent : undefined,
          sudoPassword: deploymentSudoPassword || undefined,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["deployments"] });
      setDeploymentMessage(
        deployment.status === "SUCCESS"
          ? `${deployVersion.fullName} 已${isExistingDeployment ? "升级" : "部署"}成功。`
          : "部署执行失败，请查看部署记录。",
      );
      setDeploymentSudoPassword("");
      setShowDeploymentSudoPassword(false);
      setDeployVersion(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "镜像部署失败";
      setDeploymentError(message);
      if (/sudo|提权密码|权限不足|operation not permitted/i.test(message)) {
        setShowDeploymentSudoPassword(true);
      }
      await queryClient.invalidateQueries({ queryKey: ["deployments"] });
    } finally {
      setDeploying(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow="构建交付 · Registry" title="镜像版本" />
      {deploymentMessage ? (
        <section className="omp-alert neutral">{deploymentMessage}</section>
      ) : null}
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>腾讯云镜像仓库</h2>
            <span>共 {repositories.data?.total ?? 0} 个远端仓库</span>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索腾讯云仓库名称"
              value={searchInput}
            />
          </label>
        </div>
        {repositories.isPending ? <p>正在加载腾讯云仓库…</p> : null}
        {repositories.isError ? (
          <div className="error-message">{repositories.error.message}</div>
        ) : null}
        {!repositories.isPending &&
        !repositories.isError &&
        (repositories.data?.items.length ?? 0) === 0 ? (
          <div className="empty-state compact">
            <strong>腾讯云中暂无镜像仓库</strong>
            <p>当前 Namespace 下没有可显示的远端仓库。</p>
          </div>
        ) : null}
        <div className="delivery-record-list">
          {(repositories.data?.items ?? []).map((repository) => (
            <button
              className="delivery-record image-record image-record-button"
              key={repository.name}
              onClick={() => {
                setSelectedRepository(repository);
                setTagPage(1);
                setVersionCopyStatus(null);
              }}
              type="button"
            >
              <div className="delivery-record-main">
                <div>
                  <strong>{repository.repository}</strong>
                  <span>{repository.namespace}</span>
                </div>
                <span className="status success">
                  {repository.tags.length} 个版本
                </span>
              </div>
              <code className="image-full-name">{repository.fullName}</code>
              <div className="delivery-record-meta">
                <span>已读取 {repository.tags.length} 个标签</span>
                {repository.updatedAt ? (
                  <span>
                    腾讯云更新于{" "}
                    {new Date(repository.updatedAt).toLocaleString("zh-CN")}
                  </span>
                ) : null}
              </div>
              <span className="image-record-hint">查看腾讯云全部版本</span>
            </button>
          ))}
        </div>
        {(repositories.data?.total ?? 0) > 0 ? (
          <div className="build-pagination">
            <span>
              第 {page} / {totalPages} 页，共 {repositories.data?.total ?? 0}{" "}
              个仓库
            </span>
            <label className="ci-status-filter">
              <span>每页</span>
              <select
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                value={pageSize}
              >
                {[10, 20, 50].map((size) => (
                  <option key={size} value={size}>
                    {size} 条
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={page <= 1 || repositories.isFetching}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              type="button"
            >
              上一页
            </button>
            <button
              className="secondary-button"
              disabled={page >= totalPages || repositories.isFetching}
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
              type="button"
            >
              下一页
            </button>
          </div>
        ) : null}
      </section>
      {selectedRepository ? (
        <div
          className="drawer-mask"
          onClick={(event) => {
            if (event.target === event.currentTarget)
              setSelectedRepository(null);
          }}
        >
          <aside className="drawer-panel registry-version-drawer">
            <header className="drawer-head">
              <div>
                <strong>腾讯云镜像版本</strong>
                <span>{selectedRepository.name}</span>
              </div>
              <button
                aria-label="关闭"
                className="drawer-close"
                onClick={() => setSelectedRepository(null)}
                type="button"
              >
                <X size={19} />
              </button>
            </header>
            <div className="registry-version-content">
              <section className="registry-repository-summary">
                <span>镜像仓库</span>
                <code>{selectedRepository.fullName}</code>
                <small>
                  该列表直接来源于腾讯云 Registry，共{" "}
                  {selectedRepository.tags.length} 个版本。
                </small>
              </section>
              <div className="registry-version-toolbar">
                <div>
                  <strong>远端版本</strong>
                  <span>腾讯云共 {selectedRepository.tags.length} 个标签</span>
                </div>
                <button
                  className="secondary-button"
                  disabled={repositories.isFetching}
                  onClick={() => void repositories.refetch()}
                  type="button"
                >
                  <RefreshCw
                    className={repositories.isFetching ? "is-spinning" : ""}
                    size={14}
                  />
                  刷新
                </button>
              </div>
              <div className="registry-version-list">
                {visibleTags.map((version) => (
                  <article className="registry-version-item" key={version.tag}>
                    <div className="registry-version-title">
                      <div className="registry-version-tag">
                        <code>{version.tag}</code>
                        <button
                          aria-label={`复制版本号 ${version.tag}`}
                          className="version-copy-button"
                          onClick={() => void copyImageVersion(version.tag)}
                          title={`复制版本号 ${version.tag}`}
                          type="button"
                        >
                          {versionCopyStatus?.tag === version.tag &&
                          versionCopyStatus.success ? (
                            <Check size={13} />
                          ) : (
                            <Copy size={13} />
                          )}
                          {versionCopyStatus?.tag === version.tag
                            ? versionCopyStatus.success
                              ? "已复制"
                              : "复制失败"
                            : "复制"}
                        </button>
                      </div>
                      <div className="registry-version-actions">
                        {version.tag === "latest" ? (
                          <span className="status success">latest</span>
                        ) : null}
                        {version.imageVersionId ? (
                          <button
                            className="secondary-button compact-button"
                            onClick={() => openDeployment(version)}
                            type="button"
                          >
                            <Rocket size={13} />
                            部署
                          </button>
                        ) : (
                          <span className="status draft">未入库</span>
                        )}
                      </div>
                    </div>
                    <code className="registry-version-full-name">
                      {version.fullName}
                    </code>
                    {version.recorded ? (
                      <div className="registry-version-meta">
                        <span>Build #{version.buildNumber}</span>
                        <code>{version.commitSha?.slice(0, 10)}</code>
                        <span>
                          {version.createdAt
                            ? new Date(version.createdAt).toLocaleString(
                                "zh-CN",
                              )
                            : ""}
                        </span>
                        {version.digest ? <code>{version.digest}</code> : null}
                      </div>
                    ) : (
                      <span className="registry-remote-only">
                        腾讯云远端标签 · 暂无交付中心构建元数据
                      </span>
                    )}
                  </article>
                ))}
              </div>
              {selectedRepository.tags.length === 0 ? (
                <div className="empty-state compact">
                  腾讯云中暂无镜像标签。
                </div>
              ) : null}
              {selectedRepository.tags.length > 0 ? (
                <div className="build-pagination registry-tag-pagination">
                  <span>
                    第 {tagPage} / {tagTotalPages} 页，共{" "}
                    {selectedRepository.tags.length} 个版本
                  </span>
                  <label className="ci-status-filter">
                    <span>每页</span>
                    <select
                      onChange={(event) => {
                        setTagPageSize(Number(event.target.value));
                        setTagPage(1);
                      }}
                      value={tagPageSize}
                    >
                      {[10, 20, 50].map((size) => (
                        <option key={size} value={size}>
                          {size} 条
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    disabled={tagPage <= 1}
                    onClick={() =>
                      setTagPage((value) => Math.max(1, value - 1))
                    }
                    type="button"
                  >
                    上一页
                  </button>
                  <button
                    className="secondary-button"
                    disabled={tagPage >= tagTotalPages}
                    onClick={() =>
                      setTagPage((value) => Math.min(tagTotalPages, value + 1))
                    }
                    type="button"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
      {deployVersion ? (
        <div
          className="confirm-mask deployment-modal-mask"
          onClick={(event) => {
            if (event.target !== event.currentTarget || deploying) return;
            setDeploymentSudoPassword("");
            setShowDeploymentSudoPassword(false);
            setDeployVersion(null);
          }}
          role="presentation"
        >
          <section
            aria-modal="true"
            aria-label="部署镜像版本"
            className="confirm-dialog deployment-modal"
            role="dialog"
          >
            <div className="drawer-head">
              <div>
                <strong>部署镜像版本</strong>
                <span>更新远程服务器上的 Compose 服务</span>
              </div>
              <button
                aria-label="关闭"
                className="drawer-close"
                disabled={deploying}
                onClick={() => {
                  setDeploymentSudoPassword("");
                  setShowDeploymentSudoPassword(false);
                  setDeployVersion(null);
                }}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="drawer-form"
              onSubmit={(event) => void deployImage(event)}
            >
              <section className="deployment-image-summary">
                <span>待部署镜像</span>
                <code>{deployVersion.fullName}</code>
                <small>
                  Build #{deployVersion.buildNumber} ·{" "}
                  {deployVersion.commitSha?.slice(0, 10)}
                </small>
              </section>
              <section className="deployment-environment-step">
                <strong>选择部署环境</strong>
                <div
                  aria-label="部署环境"
                  className="deployment-environment-tabs"
                  role="tablist"
                >
                  {deploymentEnvironmentTabs.map((environment) => (
                    <button
                      aria-selected={
                        deploymentEnvironment === environment.value
                      }
                      className={
                        deploymentEnvironment === environment.value
                          ? "is-active"
                          : ""
                      }
                      key={environment.value}
                      onClick={() => {
                        setDeploymentEnvironment(environment.value);
                        setSelectedComposePath("");
                        setManualComposeActive(false);
                        setManualComposeContent("");
                        setDeploymentError("");
                      }}
                      role="tab"
                      type="button"
                    >
                      {environment.label}
                    </button>
                  ))}
                </div>
              </section>
              {deployDirectories.isPending || deployServers.isPending ? (
                <p className="deployment-loading">正在读取环境部署信息…</p>
              ) : selectedDeploymentDirectory?.serverId ? (
                <section className="deployment-target-summary">
                  <div className="deployment-target-item">
                    <span>部署目录</span>
                    <code>{selectedDeploymentDirectory.path}</code>
                  </div>
                  <div className="deployment-target-item">
                    <span>目标服务器</span>
                    <div className="deployment-server-value">
                      <strong>
                        {selectedDeploymentServer?.name ?? "服务器信息不可用"}
                      </strong>
                      <small>
                        {selectedDeploymentServer?.sshAlias ?? "无 SSH 别名"}
                      </small>
                      <span
                        className={`status ${
                          deploymentServerCheck.isPending
                            ? "draft"
                            : selectedDeploymentServer?.status === "ONLINE"
                              ? "success"
                              : "danger"
                        }`}
                      >
                        {deploymentServerCheck.isPending
                          ? "正在实时检测"
                          : selectedDeploymentServer
                            ? serverStatusLabels[
                                selectedDeploymentServer.status
                              ]
                            : "信息不可用"}
                      </span>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="omp-alert neutral">
                  {selectedDeploymentDirectory
                    ? "当前环境的旧部署目录没有关联服务器，请到应用接入中删除后重新配置。"
                    : "当前环境尚未配置部署目录，请先到应用接入中配置。"}
                </section>
              )}
              {deploymentServerCheck.isError ? (
                <div className="error-message">
                  目标服务器实时检测失败：
                  {deploymentServerCheck.error.message}
                </div>
              ) : null}
              {composeResolution.isPending ? (
                <p className="deployment-loading">
                  正在依次查找当前环境、其他环境和项目库中的 Compose…
                </p>
              ) : null}
              {effectiveComposeFiles.length > 0 ? (
                <label className="compose-file-selector">
                  <span>
                    {composeFileSource === "SERVER"
                      ? "当前环境 Docker Compose 文件"
                      : composeFileSource === "OTHER_ENVIRONMENT"
                        ? "其他环境 Docker Compose 文件"
                        : composeFileSource === "REPOSITORY"
                          ? "项目库 Docker Compose 文件"
                          : "手工配置 Docker Compose 文件"}
                  </span>
                  <div className="compose-file-select-control">
                    <FileText aria-hidden="true" size={16} />
                    <select
                      required
                      disabled={manualComposeActive}
                      value={selectedComposePath}
                      onChange={(event) =>
                        setSelectedComposePath(event.target.value)
                      }
                    >
                      <option value="">
                        {effectiveComposeFiles.length > 1
                          ? "检测到多个文件，请选择"
                          : "请选择 Docker Compose 文件"}
                      </option>
                      {effectiveComposeFiles.map((file) => (
                        <option key={file.id} value={file.path}>
                          {file.path}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className="compose-file-select-arrow"
                      size={16}
                    />
                  </div>
                  {composeFileSource === "SERVER" &&
                  composeDeploymentDirectory ? (
                    <small>当前环境 · {composeDeploymentDirectory.path}</small>
                  ) : composeFileSource === "OTHER_ENVIRONMENT" &&
                    selectedComposeCandidate?.sourceEnvironment ? (
                    <small>
                      当前环境未配置，使用
                      {
                        deploymentEnvironmentTabs.find(
                          (item) =>
                            item.value ===
                            selectedComposeCandidate.sourceEnvironment,
                        )?.label
                      }
                      的 Compose 作为部署模板
                    </small>
                  ) : composeFileSource === "REPOSITORY" &&
                    deploymentApplication.data ? (
                    <small>
                      服务器环境均未配置，使用{" "}
                      {
                        deploymentApplication.data.gitLabProject
                          .pathWithNamespace
                      }
                      {" · "}
                      {deploymentApplication.data.releaseBranch}
                    </small>
                  ) : null}
                </label>
              ) : null}
              {!composeResolution.isPending &&
              composeResolution.data?.source === "NONE" &&
              !manualComposeActive ? (
                <section className="compose-empty-editor-entry">
                  <div>
                    <strong>未配置 Docker Compose</strong>
                    <span>
                      当前环境、其他环境和项目库中都没有可用的 Compose 内容。
                    </span>
                  </div>
                  <div className="compose-empty-actions">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setManualComposeActive(true);
                        setManualComposeFileName("compose.yml");
                        setSelectedComposePath("compose.yml");
                      }}
                      type="button"
                    >
                      在线编辑
                    </button>
                    <label className="secondary-button compose-upload-button">
                      上传文件
                      <input
                        accept=".yml,.yaml,text/yaml,application/yaml"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadComposeFile(file);
                          event.target.value = "";
                        }}
                        type="file"
                      />
                    </label>
                  </div>
                </section>
              ) : null}
              {manualComposeActive ? (
                <label className="compose-inline-editor">
                  <span>在线编辑 Compose 内容</span>
                  <textarea
                    autoFocus
                    placeholder={"services:\n  app:\n    image: nginx:latest"}
                    spellCheck={false}
                    value={manualComposeContent}
                    onChange={(event) => {
                      setManualComposeContent(event.target.value);
                      setDeploymentError("");
                    }}
                  />
                  <small>内容将在部署前校验，不会保存 sudo 密码。</small>
                </label>
              ) : selectedComposePath ? (
                <details
                  className="compose-file-preview"
                  key={`${composeFileSource}:${selectedComposePath}`}
                >
                  <summary>
                    <strong>Compose 内容</strong>
                    <code>{selectedComposePath}</code>
                  </summary>
                  <div className="compose-file-preview-content">
                    <pre>{currentComposeContent}</pre>
                  </div>
                </details>
              ) : null}
              {requiresServiceSelection ? (
                <label>
                  <span>Compose 服务名</span>
                  <select
                    required
                    value={serviceName}
                    onChange={(event) => setServiceName(event.target.value)}
                  >
                    <option value="">请选择本次部署的服务</option>
                    {composeServices.map((service) => (
                      <option key={service.name} value={service.name}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : requiresManualServiceName ? (
                <label>
                  <span>Compose 服务名</span>
                  <input
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"
                    placeholder="无法自动识别，请输入服务名"
                    required
                    value={serviceName}
                    onChange={(event) => setServiceName(event.target.value)}
                  />
                </label>
              ) : null}
              {deploymentError ? (
                <div className="error-message">{deploymentError}</div>
              ) : null}
              {showDeploymentSudoPassword ? (
                <label>
                  <span>sudo 提权密码</span>
                  <input
                    autoComplete="new-password"
                    autoFocus
                    maxLength={1024}
                    placeholder="请输入当前 SSH 用户的 sudo 密码"
                    required
                    type="password"
                    value={deploymentSudoPassword}
                    onChange={(event) => {
                      setDeploymentSudoPassword(event.target.value);
                      setDeploymentError("");
                    }}
                  />
                  <small>
                    密码仅用于本次操作且不会保存。输入后请再次点击
                    {isExistingDeployment ? "“一键升级”" : "“一键部署”"}。
                  </small>
                </label>
              ) : null}
              <div className="drawer-actions">
                <button
                  className="secondary-button"
                  disabled={deploying}
                  onClick={() => {
                    setDeploymentSudoPassword("");
                    setShowDeploymentSudoPassword(false);
                    setDeployVersion(null);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={
                    deploying ||
                    !selectedServerId ||
                    !selectedDirectoryId ||
                    !selectedComposePath ||
                    !currentComposeContent.trim() ||
                    !serviceName.trim() ||
                    composeResolution.isPending ||
                    (showDeploymentSudoPassword &&
                      !deploymentSudoPassword.trim()) ||
                    deploymentServerCheck.isPending ||
                    deploymentServerCheck.isError ||
                    selectedDeploymentServer?.status !== "ONLINE"
                  }
                  type="submit"
                >
                  <Rocket size={15} />
                  {deploying
                    ? isExistingDeployment
                      ? "升级中…"
                      : "部署中…"
                    : isExistingDeployment
                      ? "一键升级"
                      : "一键部署"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

type ServerStatusValue =
  "PENDING" | "ONLINE" | "OFFLINE" | "ERROR" | "DISABLED";

interface ServerRecord {
  id: string;
  name: string;
  sshAlias: string | null;
  host?: string | null;
  port?: number;
  username?: string | null;
  publicKey?: string | null;
  keyFingerprint?: string | null;
  hostKeyFingerprint?: string | null;
  environment: string;
  status: ServerStatusValue;
  lastTestAt: string | null;
  lastTestMessage: string | null;
}

const serverStatusLabels: Record<ServerStatusValue, string> = {
  PENDING: "正在检测",
  ONLINE: "在线",
  OFFLINE: "离线",
  ERROR: "连接失败",
  DISABLED: "已停用",
};

function serverStatusClass(status: ServerStatusValue): string {
  if (status === "ONLINE") return "success";
  if (status === "ERROR" || status === "OFFLINE") return "danger";
  return "draft";
}

function DeploymentTargetsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const targets = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiRequest<ServerRecord[]>("/servers"),
  });

  async function synchronizeTargets(): Promise<void> {
    setSyncing(true);
    try {
      const servers = await apiRequest<ServerRecord[]>("/servers/sync", {
        method: "POST",
      });
      queryClient.setQueryData(["servers"], servers);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        action={
          <button
            className="secondary-button"
            disabled={syncing}
            onClick={() => void synchronizeTargets()}
            type="button"
          >
            <RefreshCw size={16} />
            {syncing ? "同步中…" : "重新读取 SSH Config"}
          </button>
        }
        eyebrow="部署运维 · OpenSSH"
        title="部署目标"
      />
      <section className="omp-alert neutral">
        部署目标自动读取交付中心运行用户的 <code>~/.ssh/config</code>
        ，并复用该用户的 SSH
        Agent。系统会持续检测连接状态，目标不可达时自动切换为离线；平台不读取或保存
        SSH 私钥和密码。
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>SSH Config 主机</h2>
            <span>发现 {targets.data?.length ?? 0} 个明确的 Host 别名</span>
          </div>
        </div>
        {targets.isPending ? <p>正在加载部署目标…</p> : null}
        {targets.isError ? (
          <div className="error-message">{targets.error.message}</div>
        ) : null}
        {!targets.isPending && (targets.data?.length ?? 0) === 0 ? (
          <div className="empty-state">
            <strong>没有发现可用的 Host 别名</strong>
            <p>
              请在运行用户的 ~/.ssh/config 中配置具体
              Host；通配符规则不会单独展示。
            </p>
          </div>
        ) : null}
        <div className="server-list">
          {targets.data?.map((target) => (
            <article className="server-card" key={target.id}>
              <div className="server-card-main">
                <div className="server-icon">
                  <Server size={20} />
                </div>
                <div>
                  <strong>{target.name}</strong>
                  <span>
                    {target.sshAlias
                      ? `ssh ${target.sshAlias}`
                      : "旧配置缺少 SSH Config 别名"}
                  </span>
                </div>
                <span className={`status ${serverStatusClass(target.status)}`}>
                  {serverStatusLabels[target.status]}
                </span>
              </div>
              <div className="server-meta">
                <span>
                  解析目标：
                  {target.host
                    ? `${target.username ? `${target.username}@` : ""}${target.host}:${target.port ?? 22}`
                    : "OpenSSH 未返回目标信息"}
                </span>
                <span>
                  最近检测：
                  {target.lastTestAt
                    ? new Date(target.lastTestAt).toLocaleString("zh-CN")
                    : "等待首次自动检测"}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

type DeploymentStatusValue = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

interface DeploymentRecord {
  id: string;
  serviceName: string;
  imageVariable: string;
  imageFullName: string;
  status: DeploymentStatusValue;
  output: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  imageVersion: {
    buildNumber: string;
    commitSha: string;
    component: {
      name: string;
      application: { name: string };
    };
  };
  server: {
    id: string;
    name: string;
    sshAlias: string | null;
    environment: string;
  };
  deploymentDirectory: {
    id: string;
    name: string;
    path: string;
  };
  createdBy: {
    username: string;
    displayName: string | null;
  };
}

const deploymentStatusLabels: Record<DeploymentStatusValue, string> = {
  PENDING: "等待执行",
  RUNNING: "部署中",
  SUCCESS: "部署成功",
  FAILED: "部署失败",
};

function deploymentStatusClass(status: DeploymentStatusValue): string {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "active";
  return "draft";
}

function DeploymentsPage(): React.ReactElement {
  // 整套发布有独立的幂等收据和回退点；与原单镜像部署同时展示，避免把五个镜像当五次独立发布。
  const policies = useQuery({
    queryKey: ["automatic-deployment-policies"],
    queryFn: () =>
      apiRequest<
        Array<{
          id: string;
          path: string;
          autoDeployEnabled: boolean;
          autoDeployBranch: string;
          autoDeployRunnerPath: string;
          acceptanceBuildTypeId: string | null;
          application: { name: string };
          server: { name: string; sshAlias: string } | null;
        }>
      >("/deployments/automatic-policies"),
    refetchInterval: 15_000,
  });
  const releases = useQuery({
    queryKey: ["repository-releases"],
    queryFn: () =>
      apiRequest<
        Array<{
          id: string;
          status: DeploymentStatusValue;
          output: string | null;
          errorMessage: string | null;
          createdAt: string;
          acceptanceStatus: string;
          acceptanceTeamCityBuildId: string | null;
          acceptanceErrorMessage: string | null;
          acceptanceResultJson: unknown;
          build: {
            teamCityBuildId: string;
            teamCityBuildNumber: string;
            commitSha: string;
            branch: string;
            application: {
              name: string;
              teamCityConnection: { baseUrl: string };
            };
          };
          deploymentDirectory: {
            path: string;
            environment: string;
            server: { name: string; sshAlias: string } | null;
          };
        }>
      >("/deployments/repository-releases"),
    refetchInterval: 10_000,
  });
  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: () => apiRequest<DeploymentRecord[]>("/deployments"),
    refetchInterval: (query) =>
      query.state.data?.some((item) =>
        ["PENDING", "RUNNING"].includes(item.status),
      )
        ? 3_000
        : false,
  });

  return (
    <section className="page-stack">
      <PageHeader eyebrow="部署运维 · Docker Compose" title="部署记录" />
      <section className="panel">
        <div className="panel-title-row">
          <h2>整套自动发布</h2>
          <span>完整构建成功、五镜像摘要校验通过后发布</span>
        </div>
        {policies.data?.map((policy) => (
          <p key={policy.id}>
            <strong>{policy.application.name}</strong> ·{" "}
            {policy.autoDeployBranch} · {policy.server?.sshAlias} ·{" "}
            <code>{policy.path}</code> ·{" "}
            <span
              className={`status ${policy.autoDeployEnabled ? "success" : "draft"}`}
            >
              {policy.autoDeployEnabled ? "自动发布已启用" : "自动发布已暂停"}
            </span>
            {policy.acceptanceBuildTypeId
              ? " · 发布后自动浏览器验收已启用"
              : " · 未配置发布后自动验收"}
          </p>
        ))}
        {policies.isError ? (
          <p className="error-message">{policies.error.message}</p>
        ) : null}
        {releases.isError ? (
          <p className="error-message">{releases.error.message}</p>
        ) : null}
        {!releases.isPending && !releases.data?.length ? (
          <p>尚无整套发布记录。启用策略不会追溯发布历史构建。</p>
        ) : null}
        <div className="deployment-list">
          {releases.data?.map((release) => (
            <article className="deployment-record" key={release.id}>
              <div className="deployment-record-head">
                <strong>{release.build.application.name} · 整套发布</strong>
                <span
                  className={`status ${deploymentStatusClass(release.status)}`}
                >
                  {deploymentStatusLabels[release.status]}
                </span>
              </div>
              <div className="deployment-record-meta">
                <span>
                  Build #{release.build.teamCityBuildNumber} / TC{" "}
                  {release.build.teamCityBuildId}
                </span>
                <code>{release.build.commitSha.slice(0, 12)}</code>
                <span>
                  {release.build.branch} ·{" "}
                  {release.deploymentDirectory.environment} ·{" "}
                  {release.deploymentDirectory.server?.sshAlias}
                </span>
                <code>{release.deploymentDirectory.path}</code>
                <span>
                  {new Date(release.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
              {release.errorMessage ? (
                <p className="error-message">{release.errorMessage}</p>
              ) : null}
              {/* 部署成功与真实业务验收分别展示；不能以容器健康代替登录/地图/项目切换通过。 */}
              <div className="deployment-record-meta">
                <span
                  className={`status ${release.acceptanceStatus === "SUCCESS" ? "success" : release.acceptanceStatus === "FAILED" ? "danger" : ["RUNNING", "QUEUED"].includes(release.acceptanceStatus) ? "active" : "draft"}`}
                >
                  {(
                    {
                      NOT_CONFIGURED: "未配置自动验收",
                      PENDING: "等待部署后验收",
                      QUEUED: "验收已入队",
                      RUNNING: "浏览器验收中",
                      SUCCESS: "业务验收通过",
                      FAILED: "业务验收失败",
                    } as Record<string, string>
                  )[release.acceptanceStatus] ?? "验收状态待确认"}
                </span>
                {release.acceptanceTeamCityBuildId ? (
                  <a
                    href={`${release.build.application.teamCityConnection.baseUrl.replace(/\/$/, "")}/viewLog.html?buildId=${encodeURIComponent(release.acceptanceTeamCityBuildId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    TeamCity 验收 {release.acceptanceTeamCityBuildId}
                  </a>
                ) : null}
              </div>
              {release.acceptanceErrorMessage ? (
                <p className="error-message">
                  {release.acceptanceErrorMessage}
                </p>
              ) : null}
              {release.acceptanceResultJson ? (
                <details className="deployment-output">
                  <summary>查看业务验收结果</summary>
                  <pre>
                    {JSON.stringify(release.acceptanceResultJson, null, 2)}
                  </pre>
                </details>
              ) : null}
              {release.output ? (
                <details className="deployment-output">
                  <summary>查看发布收据与回退目录</summary>
                  <pre>{release.output}</pre>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>最近部署</h2>
            <span>保留最近 100 条远程部署记录</span>
          </div>
          <Link className="primary-button" to="/images">
            <Rocket size={15} />
            选择镜像部署
          </Link>
        </div>
        {deployments.isPending ? <p>正在加载部署记录…</p> : null}
        {deployments.isError ? (
          <div className="error-message">{deployments.error.message}</div>
        ) : null}
        {!deployments.isPending && (deployments.data?.length ?? 0) === 0 ? (
          <div className="empty-state">
            <strong>还没有部署记录</strong>
            <p>从镜像版本中选择一个已记录的版本开始部署。</p>
          </div>
        ) : null}
        <div className="deployment-list">
          {deployments.data?.map((deployment) => (
            <article className="deployment-record" key={deployment.id}>
              <div className="deployment-record-head">
                <div>
                  <strong>
                    {deployment.imageVersion.component.application.name} ·{" "}
                    {deployment.imageVersion.component.name}
                  </strong>
                  <span>
                    {deployment.server.environment} · {deployment.server.name} (
                    {deployment.server.sshAlias}) · {deployment.serviceName}
                  </span>
                </div>
                <span
                  className={`status ${deploymentStatusClass(deployment.status)}`}
                >
                  {deploymentStatusLabels[deployment.status]}
                </span>
              </div>
              <code className="deployment-image-name">
                {deployment.imageFullName}
              </code>
              <div className="deployment-record-meta">
                <span>Build #{deployment.imageVersion.buildNumber}</span>
                <code>{deployment.imageVersion.commitSha.slice(0, 10)}</code>
                <span>{deployment.deploymentDirectory.path}</span>
                <span>
                  {new Date(deployment.createdAt).toLocaleString("zh-CN")}
                </span>
                <span>
                  操作人：
                  {deployment.createdBy.displayName ??
                    deployment.createdBy.username}
                </span>
              </div>
              {deployment.errorMessage ? (
                <div className="error-message">{deployment.errorMessage}</div>
              ) : null}
              {deployment.output ? (
                <details className="deployment-output">
                  <summary>查看远端 Compose 输出</summary>
                  <pre>{deployment.output}</pre>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function ModulePage({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}): React.ReactElement {
  return (
    <section className="page-stack">
      <PageHeader eyebrow={phase} title={title} />
      <section className="panel module-panel">
        <span className="status draft">规划中</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <Link className="text-link" to="/">
          返回概览
        </Link>
      </section>
    </section>
  );
}

const rootRoute = createRootRoute({ component: Root });
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Shell,
});
const dashboardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: DashboardPage,
});
const gitlabRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/gitlab",
  component: GitLabPage,
});
const teamcityRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/teamcity",
  component: TeamCityPage,
});
const applicationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/applications",
  component: ApplicationsPage,
});
const buildsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/builds",
  component: BuildsPage,
});
const imagesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/images",
  component: ImagesPage,
});
const serversRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/servers",
  component: DeploymentTargetsPage,
});
const deploymentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/deployments",
  component: DeploymentsPage,
});

const moduleDefinitions = [
  [
    "/environments",
    "环境管理",
    "环境属于第二阶段部署模块，当前仅保留导航边界。",
    "ROADMAP · PHASE 2",
  ],
] as const;

const moduleRoutes = moduleDefinitions.map(
  ([path, title, description, phase]) =>
    createRoute({
      getParentRoute: () => shellRoute,
      path,
      component: () => (
        <ModulePage description={description} phase={phase} title={title} />
      ),
    }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    dashboardRoute,
    gitlabRoute,
    teamcityRoute,
    applicationsRoute,
    buildsRoute,
    imagesRoute,
    serversRoute,
    deploymentsRoute,
    ...moduleRoutes,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
