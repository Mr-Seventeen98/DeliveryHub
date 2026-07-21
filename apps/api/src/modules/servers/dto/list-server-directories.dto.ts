import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class ListServerDirectoriesDto {
  @Matches(/^\//)
  path = "/";

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^[^\r\n]*$/)
  sudoPassword?: string;
}
