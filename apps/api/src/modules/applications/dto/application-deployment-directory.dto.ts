import { DeploymentEnvironment } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateApplicationDeploymentDirectoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^(?!\.{1,2}$)[^/\u0000-\u001f\u007f]+$/)
  name!: string;

  @Matches(/^\//)
  parentPath!: string;

  @IsUUID()
  serverId!: string;

  @IsEnum(DeploymentEnvironment)
  environment!: DeploymentEnvironment;

  @IsOptional()
  @IsBoolean()
  createDirectory?: boolean = true;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^[^\r\n]*$/)
  sudoPassword?: string;
}
