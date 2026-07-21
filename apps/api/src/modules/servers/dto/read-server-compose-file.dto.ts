import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class ReadServerComposeFileDto {
  @IsString()
  @MaxLength(4096)
  @Matches(/^\//)
  directoryPath!: string;

  @IsString()
  @Matches(/^(?:compose|docker-compose)\.ya?ml$/i)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^[^\r\n]*$/)
  sudoPassword?: string;
}
