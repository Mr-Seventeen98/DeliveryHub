import { CredentialType } from "@prisma/client";
import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CreateCredentialDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: CredentialType })
  @IsEnum(CredentialType)
  type!: CredentialType;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  secret!: string;

  @ApiProperty({ required: false, format: "date-time" })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
