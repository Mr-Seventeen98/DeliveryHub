import { RegistryType } from "@prisma/client";
import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MinLength
} from "class-validator";

export class CreateRegistryConnectionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: RegistryType })
  @IsEnum(RegistryType)
  registryType!: RegistryType;

  @ApiProperty({ example: "https://ccr.ccs.tencentyun.com" })
  @IsUrl({ require_tld: false })
  registryUrl!: string;

  @ApiProperty()
  @IsString()
  namespace!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  usernameCredentialId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  passwordCredentialId!: string;

  @ApiProperty({ required: false, format: "uuid" })
  @IsOptional()
  @IsUUID()
  cloudSecretIdCredentialId?: string;

  @ApiProperty({ required: false, format: "uuid" })
  @IsOptional()
  @IsUUID()
  cloudSecretKeyCredentialId?: string;

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  verifySsl?: boolean;
}

export class UpdateRegistryConnectionDto extends PartialType(
  CreateRegistryConnectionDto
) {}
