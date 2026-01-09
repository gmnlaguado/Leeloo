# 🟣 Leeloo - AI Assistant for Working Women

![Leeloo Banner](./docs/assets/leeloo-banner.png)

> **"Multipass to organized life"** - An AI-powered personal assistant inspired by The Fifth Element, designed specifically for working mothers and professional women.

## 🎯 What is Leeloo?

Leeloo is a voice-first AI assistant that acts as:
- **Personal Assistant** - Manages tasks, calendar, emails
- **Life Coach** - Motivational support and habit building  
- **Spiritual Companion** - Optional Christian affirmations and guidance
- **Family Hub** - Parent dashboard + child mode with approval workflows

### Key Features

✨ **Voice Activation**: "Hey Leeloo" / "Hola Leeloo"  
📅 **Smart Scheduling**: Google Calendar, Outlook integration  
📧 **Email Management**: Gmail composition and sending  
🛒 **Shopping Lists**: Amazon & Instacart integration  
👨‍👩‍👧‍👦 **Family Mode**: Child requests with parental approval  
🌍 **Multilingual**: English, Spanish, Portuguese  
🧠 **Contextual Memory**: Learns habits and preferences  
💖 **Empathetic**: Warm, motivating, professional tone  

---

## 🏗️ Architecture

This is a monorepo containing:

```
leeloo/
├── apps/
│   ├── mobile/          # React Native + Expo (iOS & Android)
│   └── web-admin/       # Web dashboard (React + Next.js)
├── packages/
│   ├── mobile-shared/   # Shared mobile utilities
│   ├── ui-components/   # Reusable UI components
│   └── ai-prompts/      # Prompt templates & management
├── services/
│   ├── api/             # Main backend (NestJS)
│   ├── worker/          # Background jobs (BullMQ)
│   └── ai-orchestrator/ # AI pipeline orchestration
├── infra/
│   ├── supabase/        # Database schemas & migrations
│   ├── terraform/       # Infrastructure as code
│   └── k8s/             # Kubernetes configs (Helm)
└── docs/                # Documentation
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Mobile** | React Native, Expo, TypeScript |
| **Backend** | Node.js, NestJS, TypeScript |
| **Database** | Supabase (PostgreSQL), pgvector |
| **AI/ML** | OpenAI GPT-4, Whisper, TTS |
| **Queue** | Redis, BullMQ |
| **Auth** | Supabase Auth (OAuth2) |
| **Storage** | Supabase Storage (S3-compatible) |
| **Infra** | Vercel, Render, AWS/GCP |
| **CI/CD** | GitHub Actions |
| **Monitoring** | Sentry, Prometheus, Grafana |

---

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.x
- npm >= 9.x
- Expo CLI (`npm install -g expo-cli`)
- Supabase account (free tier works)
- OpenAI API key

### Installation

1. **Clone and install dependencies**:
```bash
cd F:\Leeloo
npm install
```

2. **Set up environment variables**:
```bash
cp .env.example .env
# Edit .env with your actual credentials
```

3. **Set up Supabase**:
```bash
# Run migrations
cd infra/supabase
supabase db push
```

4. **Start all services**:
```bash
# Terminal 1: API
npm run api

# Terminal 2: Worker
npm run worker

# Terminal 3: AI Orchestrator
npm run ai

# Terminal 4: Mobile app
npm run mobile
```

### Development Workflow

```bash
# Install dependencies
npm install

# Run all in dev mode (uses turbo)
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Format code
npm run format

# Run tests
npm run test

# Build all
npm run build
```

---

## 📱 Mobile App (React Native)

```bash
cd apps/mobile

# iOS
npm run ios

# Android
npm run android

# Web (for testing)
npm run web
```

### Building for Production

```bash
# iOS (requires Mac)
eas build --platform ios

# Android
eas build --platform android

# Submit to stores
eas submit
```

---

## 🔧 Backend API (NestJS)

```bash
cd services/api

# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

**API Documentation**: http://localhost:3000/api/docs (Swagger)

---

## 🧠 AI Orchestrator

Handles voice processing, intent extraction, and memory management.

```bash
cd services/ai-orchestrator
npm run start:dev
```

Key responsibilities:
- Wake word detection coordination
- Speech-to-text (Whisper)
- Intent extraction (GPT-4)
- Memory retrieval & storage
- Text-to-speech (OpenAI TTS)

---

## 🗄️ Database Schema

See `infra/supabase/migrations/` for SQL schemas.

Main tables:
- `profiles` - User profiles
- `tasks` - To-dos and reminders
- `memories` - Contextual memory storage
- `integrations` - OAuth credentials (encrypted)
- `child_requests` - Child mode approvals
- `devices` - Push tokens & wake word settings

---

## 🔐 Security & Privacy

- ✅ End-to-end encryption for OAuth tokens
- ✅ Audio not stored by default (opt-in only)
- ✅ GDPR & CCPA compliant
- ✅ User-controlled data retention
- ✅ Configurable "listening hours"
- ✅ Transparent wake word detection

---

## 🌍 Internationalization

Supported languages:
- 🇺🇸 English
- 🇪🇸 Spanish
- 🇧🇷 Portuguese

See `packages/mobile-shared/i18n/` for translations.

---

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

---

## 📊 Monitoring & Analytics

- **Sentry**: Error tracking
- **Prometheus + Grafana**: Metrics & dashboards
- **Supabase Analytics**: Database performance
- **Custom KPIs**: Wake events, task creation rate, NLU accuracy

---

## 🛣️ Roadmap

### Phase 1 - MVP (30 days)
- [x] Repository setup
- [ ] Wake word detection
- [ ] Basic voice pipeline (STT → Intent → Action → TTS)
- [ ] Task creation via voice
- [ ] Google Calendar integration

### Phase 2 - Beta (60 days)
- [ ] Gmail integration
- [ ] Memory layer (embeddings)
- [ ] Parent dashboard
- [ ] Child mode + approvals
- [ ] 50 beta testers

### Phase 3 - Launch (90 days)
- [ ] Multilingual support
- [ ] Payment integration (Stripe)
- [ ] App Store & Play Store release
- [ ] Emotional load detection
- [ ] CarPlay/Android Auto

### Future
- [ ] Leeloo Marketplace (coaches, community)
- [ ] Smart routine builder
- [ ] Mom AI Shield (limit child requests)
- [ ] Integration with smart home devices

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📄 License

Proprietary - All rights reserved © 2024 Leeloo Inc.

---

## 💬 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/leeloo/leeloo/issues)
- **Email**: support@leeloo.ai
- **Community**: [Discord](https://discord.gg/leeloo)

---

## 🙏 Acknowledgments

Inspired by Leeloo from *The Fifth Element* - a supreme being designed to bring order, protection, and hope.

Built with ❤️ for working mothers everywhere.

---

**"Leeloo Dallas, Multipass"** 🟣
