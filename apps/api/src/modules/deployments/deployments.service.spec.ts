import { describe, expect, it } from "vitest";
import { ServerStatus } from "@prisma/client";
import {
  buildDockerComposeDeploymentScript,
  updateComposeServiceImage,
  validateDeploymentSelection,
} from "./deployments.service";

describe("validateDeploymentSelection", () => {
  it("accepts a project directory configured for the selected server", () => {
    expect(() =>
      validateDeploymentSelection(
        "application-1",
        {
          applicationId: "application-1",
          enabled: true,
          serverId: "server-1",
        },
        { id: "server-1", enabled: true, status: ServerStatus.ONLINE },
      ),
    ).not.toThrow();
  });

  it("rejects a directory that belongs to another project", () => {
    expect(() =>
      validateDeploymentSelection(
        "application-1",
        { applicationId: "application-2", enabled: true },
        { id: "server-1", enabled: true, status: ServerStatus.ONLINE },
      ),
    ).toThrow("configured for this application");
  });

  it("rejects a server other than the one used to create the directory", () => {
    expect(() =>
      validateDeploymentSelection(
        "application-1",
        {
          applicationId: "application-1",
          enabled: true,
          serverId: "server-1",
        },
        { id: "server-2", enabled: true, status: ServerStatus.ONLINE },
      ),
    ).toThrow("configured for this directory");
  });
});

describe("buildDockerComposeDeploymentScript", () => {
  it("builds a targeted compose pull and update command", () => {
    const script = buildDockerComposeDeploymentScript({
      directory: "/srv/video web",
      serviceName: "web",
      imageFullName: "ccr.example.com/team/video:web-17",
      registryHost: "ccr.example.com",
      registryUsername: "delivery",
      registryPassword: "secret",
      composeFilePath: "deploy/compose.yml",
      composeFileContent:
        "services:\n  web:\n    image: ccr.example.com/team/video:web-17\n",
      composeFileSource: "REPOSITORY",
    });

    expect(script).toContain("cd '/srv/video web'");
    expect(script).toContain("ccr.example.com/team/video:web-17");
    expect(script).toContain("service='web'");
    expect(script).toContain("compose_file='compose.yml'");
    expect(script).toContain("services:");
    expect(script).toContain('pull "$service"');
    expect(script).toContain('up -d --no-deps "$service"');
  });

  it("quotes registry credentials before sending the script over stdin", () => {
    const script = buildDockerComposeDeploymentScript({
      directory: "/srv/app",
      serviceName: "api",
      imageFullName: "ccr.example.com/team/api:17",
      registryHost: "ccr.example.com",
      registryUsername: "user'name",
      registryPassword: "pass'word",
      composeFilePath: "docker-compose.yaml",
      composeFileContent: "services:\n  api:\n    image: ${DELIVERY_IMAGE}\n",
      composeFileSource: "REPOSITORY",
    });

    expect(script).toContain(`'user'"'"'name'`);
    expect(script).toContain(`'pass'"'"'word'`);
  });

  it("atomically updates an existing server Compose file", () => {
    const script = buildDockerComposeDeploymentScript({
      directory: "/srv/app",
      serviceName: "api",
      imageFullName: "ccr.example.com/team/api:18",
      registryHost: "ccr.example.com",
      registryUsername: "delivery",
      registryPassword: "secret",
      composeFilePath: "compose.yml",
      composeFileContent:
        "services:\n  api:\n    image: ccr.example.com/team/api:18\n",
      composeFileSource: "SERVER",
    });

    expect(script).toContain("更新后的 Compose 文件校验失败");
    expect(script).toContain("delivery-hub.tmp");
    expect(script).toContain("delivery-hub.backup");
    expect(script).toContain("rollback_compose");
    expect(script).not.toContain("override_file");
    expect(script).not.toContain("image: old");
    expect(script).toContain("ccr.example.com/team/api:18");
    expect(script.indexOf("then had_original=1")).toBeLessThan(
      script.indexOf("trap rollback_compose"),
    );
    expect(script.indexOf("更新后的 Compose 文件校验失败")).toBeLessThan(
      script.indexOf('cp -p "$compose_file"'),
    );
  });
});

describe("updateComposeServiceImage", () => {
  it("updates only the selected service and preserves surrounding comments", () => {
    const updated = updateComposeServiceImage(
      "# project compose\nservices:\n  web:\n    image: old/web:1\n  worker:\n    image: old/worker:1\n",
      "web",
      "ccr.example.com/team/web:2",
    );

    expect(updated).toContain("# project compose");
    expect(updated).toContain("image: ccr.example.com/team/web:2");
    expect(updated).toContain("image: old/worker:1");
  });

  it("rejects a service that is absent from the Compose file", () => {
    expect(() =>
      updateComposeServiceImage(
        "services:\n  web:\n    image: old/web:1\n",
        "api",
        "ccr.example.com/team/api:2",
      ),
    ).toThrow("Compose 服务 api 不存在");
  });
});
