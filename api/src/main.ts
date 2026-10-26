import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { DatabaseService } from './database.service';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.get(DatabaseService).initialize();
  const webDist = join(__dirname, '../../web/dist');
  if (existsSync(webDist)) app.useStaticAssets(webDist);
  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
void bootstrap();
