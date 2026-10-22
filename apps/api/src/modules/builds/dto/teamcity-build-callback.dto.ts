import {
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  IsObject,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class TeamCityImageCallbackDto {
  @IsString()
  @MinLength(1)
  component_code!: string;

  @IsString()
  registry!: string;

  @IsString()
  namespace!: string;

  @IsString()
  repository!: string;

  @IsString()
  tag!: string;

  @IsOptional()
  @IsString()
  digest?: string;
}

export class TeamCityBuildCallbackDto {
  /** 仓库模式的版本化执行清单；服务层按配置快照校验，不能仅凭 SUCCESS 登记镜像。 */
  @IsOptional()
  @IsObject()
  pipeline_result?: Record<string, unknown>;
  @IsUUID()
  teamcity_connection_id!: string;

  @IsUUID()
  delivery_project_id!: string;

  @IsString()
  teamcity_build_id!: string;

  @IsString()
  build_number!: string;

  @IsIn(["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELED"])
  status!: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";

  @IsString()
  branch!: string;

  @IsString()
  commit_sha!: string;

  @IsOptional()
  @IsISO8601()
  started_at?: string;

  @IsOptional()
  @IsISO8601()
  finished_at?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamCityImageCallbackDto)
  images!: TeamCityImageCallbackDto[];
}
