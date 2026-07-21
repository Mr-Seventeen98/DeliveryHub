export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string | string[]; details?: unknown };
  requestId: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const JOB_NAMES = {
  GITLAB_SYNC_PROJECTS: "gitlab.sync-projects",
  REPOSITORY_SCAN: "repository.scan",
  PIPELINE_PROVISION: "pipeline.provision",
  TEAMCITY_TRIGGER_BUILD: "teamcity.trigger-build",
  TEAMCITY_SYNC_BUILD_STATUS: "teamcity.sync-build-status",
  REGISTRY_SYNC_IMAGE: "registry.sync-image"
} as const;
