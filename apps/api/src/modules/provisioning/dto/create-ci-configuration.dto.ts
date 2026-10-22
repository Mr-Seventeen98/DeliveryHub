import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsObject,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CiComponentInputDto {
  /** 仓库模式沿用配置中的稳定 code；旧模式仍从 Dockerfile 路径生成。 */
  @IsOptional()
  @Matches(/^[a-z][a-z0-9-]*$/)
  code?: string;

  @IsOptional()
  @IsString()
  buildContext?: string;

  @IsOptional()
  @IsObject()
  buildArgs?: Record<string, string>;
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  dockerfilePath!: string;

  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  imageRepository!: string;
}

export class CreateCiConfigurationDto {
  /** 缺省保留旧组件模式，避免旧客户端/已有项目行为变化。 */
  @IsOptional()
  @IsIn(["COMPONENT_DOCKER", "REPOSITORY_PIPELINE"])
  ciExecutionMode?: "COMPONENT_DOCKER" | "REPOSITORY_PIPELINE";

  @IsOptional()
  @IsString()
  pipelineDefinitionPath?: string;

  @IsOptional()
  @IsUUID()
  registryConnectionId?: string;
  @IsUUID()
  gitLabProjectId!: string;

  @IsUUID()
  teamCityConnectionId!: string;

  @IsString()
  @MinLength(1)
  releaseBranch!: string;

  @IsIn(["existing", "new"])
  teamCityGroupMode!: "existing" | "new";

  @IsOptional()
  @IsString()
  teamCityGroupId?: string;

  @IsOptional()
  @IsString()
  teamCityGroupName?: string;

  @IsBoolean()
  autoBuildEnabled!: boolean;

  @IsBoolean()
  runFirstBuild!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CiComponentInputDto)
  components!: CiComponentInputDto[];
}
