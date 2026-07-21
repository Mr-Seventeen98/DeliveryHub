import { Module } from "@nestjs/common";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { EncryptionService } from "./encryption.service";

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, EncryptionService],
  exports: [CredentialsService]
})
export class CredentialsModule {}
