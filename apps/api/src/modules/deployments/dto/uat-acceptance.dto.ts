import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** null 表示停止为后续发布创建验收；不会取消已经在运行的验收或回写历史记录。 */
export class ConfigureUatAcceptanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Matches(/^[A-Za-z0-9_]+$/)
  buildTypeId!: string | null;
}

/** 通知仅传 TeamCity 数字构建号；报告必须由 Hub 从可信 TeamCity 连接自行读取。 */
export class UatAcceptanceCallbackDto {
  @IsString()
  @Matches(/^\d+$/)
  teamCityBuildId!: string;
}
