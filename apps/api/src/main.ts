import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { isTrustedProxyAddress, trustedProxyCidrs } from './security/client-ip.util';

function csv(value?: string): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const express = app.getHttpAdapter().getInstance();

  const proxyCidrs = trustedProxyCidrs();
  if (proxyCidrs.length > 0) {
    express.set('trust proxy', (ip: string) => isTrustedProxyAddress(ip));
  }

  const configuredOrigins = csv(process.env.CORS_ALLOWED_ORIGINS);
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && configuredOrigins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
  }
  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`API running on http://localhost:${port}`);
}
bootstrap();