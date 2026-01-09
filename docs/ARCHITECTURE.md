# 🏗️ Leeloo Architecture

## System Overview

Leeloo is a voice-first AI assistant built with a modern, scalable microservices architecture.

```
┌─────────────┐
│ Mobile App  │ (React Native + Expo)
│ iOS/Android │
└──────┬──────┘
       │ HTTPS/WebSocket
       ▼
┌─────────────┐
│  Backend    │ (NestJS)
│  API Layer  │
└──────┬──────┘
       │
       ├─────────┐
       ▼         ▼
┌──────────┐ ┌──────────────┐
│ Supabase │ │ AI Services  │
│ Postgres │ │ (OpenAI GPT) │
│  + Auth  │ │ Whisper, TTS │
└──────────┘ └──────────────┘
```

## Component Architecture

### 1. Mobile App (React Native + Expo)

**Location:** `apps/mobile/`

**Key Features:**
- Cross-platform (iOS & Android)
- Expo Router for navigation
- Zustand for state management
- React Query for server state
- Wake word detection (local)
- Audio recording & playback

**Structure:**
```
app/
  _layout.tsx          # Root layout
  index.tsx            # Entry point
  (auth)/              # Auth screens
  (tabs)/              # Main app tabs
    home.tsx
    tasks.tsx
    calendar.tsx
    settings.tsx
components/            # Reusable components
  VoiceButton.tsx
  TaskList.tsx
  MotivationalCard.tsx
store/                 # Zustand stores
  auth.ts
  voice.ts
lib/                   # Utilities
  supabase.ts
  api.ts
```

### 2. Backend API (NestJS)

**Location:** `services/api/`

**Responsibilities:**
- REST API endpoints
- Authentication & authorization
- Business logic orchestration
- Database operations
- Integration with AI services

**Module Structure:**
```
src/
  main.ts              # Entry point
  app.module.ts        # Root module
  auth/                # Authentication
  voice/               # Voice processing
  tasks/               # Task management
  calendar/            # Calendar integration
  integrations/        # OAuth integrations
  memories/            # Memory management
  supabase/            # Database client
```

**Key Endpoints:**
- `POST /v1/voice/process` - Process voice or text input
- `GET /v1/tasks` - Get user tasks
- `POST /v1/tasks` - Create task
- `POST /v1/integrations/connect` - Connect OAuth integration

### 3. AI Orchestrator (Microservice)

**Location:** `services/ai-orchestrator/`

**Responsibilities:**
- GPT-4 prompt management
- Intent extraction
- Memory retrieval & contextualization
- TTS generation
- Whisper transcription

**Pipeline:**
```
Audio Input → Whisper STT → Intent Extraction (GPT-4)
                                     ↓
                           Memory Retrieval
                                     ↓
                           Action Planning
                                     ↓
                           Response Generation (GPT-4)
                                     ↓
                           TTS (OpenAI Voice)
```

### 4. Worker Service (Background Jobs)

**Location:** `services/worker/`

**Responsibilities:**
- Calendar synchronization
- Email sending (via Gmail/Outlook APIs)
- Shopping cart management
- Scheduled reminders
- Data cleanup tasks

**Job Queue:** BullMQ + Redis

### 5. Database (Supabase / PostgreSQL)

**Key Tables:**
- `profiles` - User profiles
- `tasks` - To-dos and reminders
- `memories` - Contextual AI memory
- `integrations` - OAuth credentials
- `child_requests` - Child mode approvals
- `calendar_events` - Synced calendar cache
- `wake_events` - Analytics logs

**Features:**
- Row Level Security (RLS)
- Real-time subscriptions
- Storage for audio/avatars
- Built-in authentication

## Data Flow

### Voice Command Flow

```
1. User says "Hey Leeloo"
   ↓
2. Wake word detected (on-device)
   ↓
3. Record audio (3-10 seconds)
   ↓
4. Send to backend API
   ↓
5. Whisper transcription
   ↓
6. GPT-4 intent extraction
   {
     "action": "create_task",
     "title": "Buy groceries",
     "due_at": "2024-01-15T18:00:00Z"
   }
   ↓
7. Execute action (create task in DB)
   ↓
8. Generate response with GPT-4
   "Perfecto, agregué 'Comprar víveres' a tu lista. ¿Algo más?"
   ↓
9. Generate TTS audio
   ↓
10. Send response to client
    {
      "transcription": "...",
      "response_text": "...",
      "response_audio_url": "https://..."
    }
   ↓
11. Play audio response to user
```

### Task Creation Flow

```
Mobile App → POST /v1/tasks → API Server
                                    ↓
                              Validate auth
                                    ↓
                              Insert into DB (Supabase)
                                    ↓
                              Return task object
                                    ↓
                              Real-time sync to mobile
```

## Security Architecture

### Authentication
- JWT tokens via Supabase Auth
- OAuth 2.0 for integrations
- Token refresh mechanism

### Authorization
- Row Level Security (RLS) in database
- Guard-based authorization in API
- Role-based access control (RBAC)

### Data Protection
- Encryption at rest (database)
- TLS/HTTPS in transit
- Encrypted OAuth credentials (AES-256)
- Optional audio logging (opt-in only)

### Privacy
- GDPR & CCPA compliant
- User data export
- Right to deletion
- Transparent data usage

## Scalability Considerations

### Current Architecture (MVP)
- Single API instance
- Supabase free/pro tier
- OpenAI API with rate limiting

### Future Scaling
- **Horizontal scaling:** Multiple API instances behind load balancer
- **Caching:** Redis for sessions, frequently accessed data
- **CDN:** CloudFlare for static assets
- **Database:** Read replicas for analytics queries
- **AI Layer:** Self-hosted models (Whisper, LLaMA) for cost reduction
- **Queueing:** BullMQ for async jobs
- **Monitoring:** Prometheus + Grafana

## Technology Stack

| Layer | Technology | Why? |
|-------|-----------|------|
| **Mobile** | React Native + Expo | Cross-platform, fast iteration, OTA updates |
| **Backend** | NestJS | TypeScript, modular, DI, well-structured |
| **Database** | Supabase (PostgreSQL) | Auth + DB + Storage in one, real-time, RLS |
| **AI/ML** | OpenAI GPT-4, Whisper, TTS | State-of-the-art quality, fast, reliable |
| **Queue** | BullMQ + Redis | Reliable job processing, retries, scheduling |
| **Auth** | Supabase Auth | OAuth, JWT, MFA support |
| **Storage** | Supabase Storage | S3-compatible, integrated with DB |
| **CI/CD** | GitHub Actions | Automated testing, builds, deploys |
| **Hosting** | Vercel (frontend), Render (API) | Easy deploys, auto-scaling |

## Design Patterns

### Backend
- **Module pattern** (NestJS) - Clean separation of concerns
- **Dependency Injection** - Testable, maintainable code
- **Repository pattern** - Abstraction over data access
- **Service layer** - Business logic separate from controllers

### Frontend
- **Container/Presenter** - Smart vs presentational components
- **Custom hooks** - Reusable logic
- **Context + hooks** - Global state management
- **Atomic design** - Component hierarchy

### AI
- **Prompt templates** - Reusable, version-controlled prompts
- **Memory augmentation** - Context injection for personalization
- **Fallback strategies** - Graceful degradation if AI fails

## Monitoring & Observability

### Metrics
- API response times
- Wake word detections per day
- Task creation rate
- Voice command success rate
- Error rates

### Logging
- Structured logs (JSON)
- Centralized via Sentry
- Audit logs for sensitive operations

### Alerting
- API downtime
- High error rates
- Database connection issues
- Queue backlog

## Deployment

### Environments
- **Development:** Local + staging DB
- **Staging:** Identical to production, test data
- **Production:** Live environment

### CI/CD Pipeline
```
Push to main
  ↓
GitHub Actions
  ↓
Lint + Test + Build
  ↓
Deploy API → Render
Deploy Mobile → OTA update (Expo)
  ↓
Run smoke tests
  ↓
Notify team (Slack/Discord)
```

## Future Architecture Enhancements

1. **Edge Functions** - Process wake words closer to users
2. **GraphQL API** - More flexible data fetching
3. **Event Sourcing** - Complete audit trail
4. **CQRS** - Separate read/write models for performance
5. **Microservices** - Split into smaller services (Calendar, Email, etc.)
6. **Kubernetes** - Container orchestration for scaling
7. **Self-hosted AI** - Reduce costs, improve latency

---

**Version:** 0.1.0  
**Last Updated:** 2024-01-01
