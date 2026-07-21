import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "deliveryHub.isPublic";
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
