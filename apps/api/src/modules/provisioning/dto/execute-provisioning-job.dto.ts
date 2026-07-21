import { Type } from "class-transformer";
import { IsString, IsUUID, ValidateNested } from "class-validator";
import { CreateCiConfigurationDto } from "./create-ci-configuration.dto";

export class ExecuteProvisioningJobDto {
  @IsString()
  queueJobId!: string;

  @IsUUID()
  userId!: string;

  @IsString()
  requestId!: string;

  @ValidateNested()
  @Type(() => CreateCiConfigurationDto)
  configuration!: CreateCiConfigurationDto;
}
