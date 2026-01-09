import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('v1');

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Leeloo API')
    .setDescription('AI Assistant for Working Women - REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('voice', 'Voice processing endpoints')
    .addTag('tasks', 'Task management')
    .addTag('calendar', 'Calendar integration')
    .addTag('integrations', 'Third-party integrations')
    .addTag('memories', 'Contextual memory')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`🟣 Leeloo API running on port: ${port}`);
  console.log(`📚 API Docs: http://<your-ip>:${port}/api/docs`);
}

bootstrap();
