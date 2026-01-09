# 🟣 Leeloo - Complete Setup Guide

This guide will walk you through setting up the complete Leeloo development environment.

## 📋 Prerequisites

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Git**
- **Supabase account** (free tier)
- **OpenAI API key**
- **Expo CLI** (for mobile development)

## 🚀 Quick Start

### 1. Clone and Install

```bash
cd F:\Leeloo
npm install
```

This will install dependencies for all workspaces (mobile, api, worker, etc.).

### 2. Environment Setup

Copy the example environment file:

```bash
copy .env.example .env
```

Edit `.env` and fill in your credentials:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# OpenAI
OPENAI_API_KEY=sk-your-key-here

# App URLs
API_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:19006
```

### 3. Database Setup

Follow instructions in `infra/supabase/README.md` to:
1. Create Supabase project
2. Run SQL migrations
3. Set up storage buckets

### 4. Start Development Servers

#### Option A: Start all services at once

```bash
npm run dev
```

#### Option B: Start services individually

**Terminal 1 - API Server:**
```bash
npm run api
```

**Terminal 2 - Mobile App:**
```bash
npm run mobile
```

**Terminal 3 - Worker (optional):**
```bash
npm run worker
```

**Terminal 4 - AI Orchestrator (optional):**
```bash
npm run ai
```

## 📱 Mobile Development

### iOS (requires Mac)

```bash
cd apps/mobile
npm run ios
```

### Android

```bash
cd apps/mobile
npm run android
```

### Web (for testing)

```bash
cd apps/mobile
npm run web
```

## 🔧 Backend API

The API will be available at:
- **Base URL:** http://localhost:3000
- **API Docs (Swagger):** http://localhost:3000/api/docs

### Testing API Endpoints

```bash
# Health check
curl http://localhost:3000/v1/health

# Get tasks (requires auth token)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/v1/tasks
```

## 🧪 Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:cov
```

## 🏗️ Building for Production

### Mobile App

```bash
cd apps/mobile

# iOS
eas build --platform ios --profile production

# Android
eas build --platform android --profile production
```

### Backend API

```bash
cd services/api
npm run build
npm run start:prod
```

## 🔐 Authentication

Leeloo uses Supabase Auth. To test authentication:

1. Create a user in Supabase Dashboard (Authentication > Users)
2. Or use the sign-up flow in the mobile app
3. Copy the JWT token from the response
4. Use it in API requests: `Authorization: Bearer <token>`

## 🌍 Internationalization

Currently supported languages:
- Spanish (es)
- English (en)
- Portuguese (pt)

Language files are in `packages/mobile-shared/i18n/`.

## 🐛 Troubleshooting

### "Cannot find module" errors

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Mobile app won't start

```bash
cd apps/mobile
# Clear Expo cache
npx expo start -c
```

### Database connection issues

- Verify Supabase URL and keys in `.env`
- Check that your IP is allowed in Supabase project settings
- Ensure migrations have been run

### API server errors

```bash
cd services/api
# Check logs
npm run start:dev
```

## 📚 Additional Resources

- [Architecture Overview](./ARCHITECTURE.md)
- [API Documentation](./API.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
- [Database Schema](../infra/supabase/README.md)

## 🆘 Getting Help

- GitHub Issues: [Create an issue](https://github.com/leeloo/leeloo/issues)
- Discord: [Join our community](https://discord.gg/leeloo)
- Email: support@leeloo.ai

## ✅ Verification Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file configured
- [ ] Supabase project created
- [ ] Database migrations run
- [ ] Storage buckets created
- [ ] API server running (http://localhost:3000)
- [ ] Mobile app running on device/emulator
- [ ] Can create a user and authenticate
- [ ] Can create tasks via API
- [ ] Voice processing works (requires OpenAI key)

Congratulations! You're ready to develop with Leeloo 🎉
