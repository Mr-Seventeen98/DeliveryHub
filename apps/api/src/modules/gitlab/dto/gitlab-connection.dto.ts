import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  Min,
  MinLength
} from "class-validator";

export class CreateGitLabConnectionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: "https://gitlab.example.com" })
  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @ApiProperty({ example: "https://gitlab.example.com/api/v4" })
  @IsUrl({ require_tld: false })
  apiUrl!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  tokenCredentialId!: string;

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  verifySsl?: boolean;

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean;

  @ApiProperty({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  syncIntervalMinutes?: number;
}

export class UpdateGitLabConnectionDto extends PartialType(
  CreateGitLabConnectionDto
) {}
