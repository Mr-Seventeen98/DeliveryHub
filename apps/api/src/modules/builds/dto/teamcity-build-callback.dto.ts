import {
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
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
