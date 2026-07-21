import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CiComponentInputDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  dockerfilePath!: string;

  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  imageRepository!: string;
}

export class CreateCiConfigurationDto {
  @IsUUID()
  gitLabProjectId!: string;

  @IsUUID()
  teamCityConnectionId!: string;

  @IsString()
  @MinLength(1)
  releaseBranch!: string;

  @IsIn(["existing", "new"])
  teamCityGroupMode!: "existing" | "new";

  @IsOptional()
  @IsString()
  teamCityGroupId?: string;

  @IsOptional()
  @IsString()
  teamCityGroupName?: string;

  @IsBoolean()
  autoBuildEnabled!: boolean;

  @IsBoolean()
  runFirstBuild!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CiComponentInputDto)
  components!: CiComponentInputDto[];
}
