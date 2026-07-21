import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateDeploymentDto {
  @IsUUID()
  imageVersionId!: string;

  @IsUUID()
  serverId!: string;

  @IsUUID()
  deploymentDirectoryId!: string;

  @IsString()
  @MinLength(1)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
  serviceName!: string;

  @IsString()
  @MaxLength(512)
  @Matches(
    /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).*(?:^|\/)(?:compose|docker-compose)\.ya?ml$/i,
  )
  composeFilePath!: string;

  @IsString()
  @IsIn(["SERVER", "OTHER_ENVIRONMENT", "REPOSITORY", "INLINE"])
  composeFileSource: "SERVER" | "OTHER_ENVIRONMENT" | "REPOSITORY" | "INLINE" =
    "REPOSITORY";

  @IsOptional()
  @IsUUID()
  sourceDeploymentDirectoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024 * 1024)
  composeFileContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^[^\r\n]*$/)
  sudoPassword?: string;
}
