import { Module } from "@nestjs/common";
import { AdaptersModule } from "../../adapters/adapters.module";
import { CredentialsModule } from "../credentials/credentials.module";
import {
  BuildsController,
  ImagesController,
  TeamCityBuildCallbackController,
} from "./builds.controller";
import { BuildsService } from "./builds.service";

@Module({
  imports: [AdaptersModule, CredentialsModule],
  controllers: [
    BuildsController,
    ImagesController,
    TeamCityBuildCallbackController,
  ],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
