# 🚀 Leeloo - Quick Start (5 Minutes)

Get Leeloo running on your machine in 5 minutes.

## Step 1: Install Dependencies (2 min)

```bash
cd F:\Leeloo
npm install
```

## Step 2: Set Up Environment (1 min)

Copy and edit `.env`:

```bash
copy .env.example .env
```

Minimum required values:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-key
OPENAI_API_KEY=sk-your-key
```

## Step 3: Set Up Database (1 min)

1. Create free Supabase project: https://supabase.com
2. Go to SQL Editor
3. Copy/paste from: `infra/supabase/migrations/001_initial_schema.sql`
4. Run it

## Step 4: Start Services (1 min)

```bash
# Start API
npm run api

# In another terminal, start mobile
npm run mobile
```

## Step 5: Test It! 🎉

- API: http://localhost:3000/api/docs
- Mobile: Scan QR code with Expo Go app
- Create your first task via voice or UI

## What's Next?

- [Full Setup Guide](./SETUP.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [API Documentation](./API.md)
- [Contributing](../CONTRIBUTING.md)

## Common Issues

**"Cannot find module"** → Run `npm install` in root

**API won't start** → Check `.env` has correct Supabase credentials

**Mobile app crashes** → Run `npx expo start -c` to clear cache

**Database errors** → Verify SQL migrations ran successfully

Need help? Open an issue or join Discord!
