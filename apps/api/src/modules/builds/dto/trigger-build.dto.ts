import { IsOptional, IsUUID } from "class-validator";

export class TriggerBuildDto {
  @IsUUID()
  applicationId!: string;

  @IsOptional()
  @IsUUID()
  componentId?: string;
}
