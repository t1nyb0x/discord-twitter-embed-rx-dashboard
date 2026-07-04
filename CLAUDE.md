# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Astro dev server (port 4321)
npm run build        # Type-check (astro:check) + production build
npm run preview      # Preview built artifacts

# Testing
npm run test         # Run all Vitest tests (single run)
npm run test:watch   # Watch mode
npm run test:coverage  # Coverage report (v8)

# Linting & Formatting
npm run lint         # oxlint on src/
npm run lint:fix     # Auto-fix lint issues
npm run format       # oxfmt format
npm run format:check # Check formatting without modifying

# Database
npm run db:generate  # Generate Drizzle migrations
npm run db:migrate   # Apply pending migrations
npm run db:studio    # Launch Drizzle Studio GUI
```

Run a single test file: `npx vitest run tests/unit/lib/auth.test.ts`

## Architecture

**Stack**: Astro v6 (SSR, Node.js adapter) + Preact + SQLite (Drizzle ORM) + Redis + Discord OAuth2

### Request Lifecycle

1. `src/middleware.ts` — Every request passes through here: session validation, security headers, auth guards for `/dashboard/*` and `/api/*` routes.
2. `src/startup.ts` — On app init: Redis reseed from SQLite, reconciliation job (every 10 min), audit log cleanup (daily 2 AM), version heartbeat (every 2 min).

### Data Layer

- **SQLite** (better-sqlite3 + Drizzle): persistent storage for `users`, `sessions`, `guildConfigs`, `channelWhitelist`, `configAuditLogs`. Schema in `src/lib/db/schema.ts`. Connection uses a Proxy for lazy init.
- **Redis**: session store (`lucia:session:{id}`, 7-day TTL), guild config cache (`app:guild:{guildId}:config`), OAuth state (`oauth:state:{state}`, 5-min TTL), rate limiting (sorted sets + Lua script for atomicity).

### Key Modules

| File | Responsibility |
|------|---------------|
| `src/middleware.ts` | Auth guards, security headers, session injection into `locals` |
| `src/lib/auth.ts` | Session creation/validation, cookie attributes |
| `src/lib/crypto.ts` | AES-256-GCM token encryption (scrypt key derivation) |
| `src/lib/discord.ts` | Discord API wrapper |
| `src/lib/rate-limit.ts` | Lua-based atomic rate limiting (30 logins/min per IP) |
| `src/lib/reseed.ts` | SQLite → Redis sync at startup |
| `src/startup.ts` | Background jobs initialization |

### API Routes

- `GET/POST /api/guilds/[guildId]/config` — Main guild config CRUD; reads from Redis cache, writes through to SQLite + Redis
- `GET /api/guilds/[guildId]/audit-logs` — Paginated audit log query
- `GET /api/guilds/[guildId]/channels` — Discord channel list (proxied through server)
- `POST /api/auth/discord/login` — Rate-limited OAuth initiation
- `GET /api/auth/discord/callback` — OAuth callback, sets session cookie

### Patterns & Conventions

- **API response envelope**: `{ success: boolean, data?: T, error?: { code, message } }` — use `src/lib/api-helpers.ts` builders
- **Logging**: `createLogger("ModuleName")` from `src/lib/logger.ts` (Winston)
- **TypeScript**: strict mode; `App.Locals` types defined in `src/env.d.ts`
- **Tests**: unit tests in `tests/unit/`, mock helpers in `tests/helpers.ts` for User/Session objects; Redis and DB are mocked

## Environment Variables

App secrets go in `.env.app` (separate from `.env` used by Docker Compose).

Required: `DISCORD_OAUTH2_CLIENT_ID`, `DISCORD_OAUTH2_CLIENT_SECRET`, `DISCORD_OAUTH2_REDIRECT_URI`, `SESSION_SECRET` (32+ chars), `ENCRYPTION_SALT` (16+ chars)

Optional: `DATABASE_URL` (default `file:./data/dashboard.db`), `REDIS_URL` (default `redis://redis:6379`), `ORPHAN_CONFIG_RETENTION_DAYS` (30), `AUDIT_LOG_RETENTION_DAYS` (90)
