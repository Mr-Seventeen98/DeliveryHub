import { Module } from "@nestjs/common";
import { AdaptersModule } from "../../adapters/adapters.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { RegistriesController } from "./registries.controller";
import { RegistriesService } from "./registries.service";

@Module({
  imports: [AdaptersModule, CredentialsModule],
  controllers: [RegistriesController],
  providers: [RegistriesService]
})
export class RegistriesModule {}
