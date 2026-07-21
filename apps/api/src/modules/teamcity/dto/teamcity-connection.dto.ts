import { ApiProperty, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MinLength
} from "class-validator";

export class CreateTeamCityConnectionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: "https://teamcity.example.com" })
  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  tokenCredentialId!: string;

  @ApiProperty({ default: "_Root" })
  @IsString()
  parentProjectId!: string;

  @ApiProperty({ default: true })
  @IsOptional()
  @IsBoolean()
  verifySsl?: boolean;
}

export class UpdateTeamCityConnectionDto extends PartialType(
  CreateTeamCityConnectionDto
) {}
