import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { ResponseInterceptor } from "./common/response.interceptor";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: process.env.WEB_BASE_URL ?? "http://localhost:5173",
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const openApiConfig = new DocumentBuilder()
    .setTitle("Delivery Hub API")
    .setDescription("Delivery Hub CI/CD orchestration API")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, openApiConfig),
  );

  await app.listen(Number(process.env.API_PORT ?? 3000), "0.0.0.0");
}

void bootstrap();
