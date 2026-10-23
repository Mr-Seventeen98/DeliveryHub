import { IsBoolean, IsString, MaxLength } from "class-validator";

/** 已有部署目录上的整套发布策略；启用时刻由服务端生成，客户端不能补传日期发布历史构建。 */
export class AutomaticDeploymentPolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(200)
  branch!: string;

  @IsString()
  @MaxLength(300)
  runnerPath!: string;
}
