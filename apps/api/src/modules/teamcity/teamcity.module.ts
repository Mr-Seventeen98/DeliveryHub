import { Module } from "@nestjs/common";
import { AdaptersModule } from "../../adapters/adapters.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { TeamCityController } from "./teamcity.controller";
import { TeamCityService } from "./teamcity.service";

@Module({
  imports: [AdaptersModule, CredentialsModule],
  controllers: [TeamCityController],
  providers: [TeamCityService]
})
export class TeamCityModule {}
