# NÉA STUDIO — Salon management & online booking

A full-stack system for NÉA STUDIO (Marrakech): a public website with online booking, a real-time availability dashboard, appointment management, a CRM, team schedules, digital loyalty cards with QR check-in, notifications and analytics.

> **Demo data.** The seed creates sample services, prices, team members, customers and appointments, all flagged `isDemo = true` and labelled "demo" in the UI. None of it describes the real salon. Analytics can exclude demo records, and editing a demo service or employee clears its flag. See [Replacing demo data](#replacing-demo-data).

---

## 1. Project structure

```
nea-studio/
├── docker-compose.yml          PostgreSQL 16 (port 5433) + test database
├── package.json                root scripts (setup / dev / test / build)
├── server/                     REST API + WebSockets
│   ├── prisma/
│   │   ├── schema.prisma       relational schema
│   │   ├── migrations/         SQL migrations (incl. anti-double-booking constraint)
│   │   └── seed.ts             roles, permissions, settings, admin, DEMO data
│   ├── src/
│   │   ├── index.ts            HTTP server, Socket.IO, background jobs
│   │   ├── app.ts              Express app, error handling
│   │   ├── config/env.ts       validated environment variables
│   │   ├── lib/                prisma, errors, validation, ids, audit, time (Luxon), realtime
│   │   ├── middleware/auth.ts  JWT authentication + role/permission guards
│   │   ├── modules/
│   │   │   ├── availability/   engine.ts (pure slot engine) + availability.service.ts
│   │   │   ├── appointments/   transactional booking, reschedule, cancel, complete
│   │   │   ├── loyalty/        stamps, configurable rewards, redemption, QR codes
│   │   │   ├── notifications/  email (SMTP) + WhatsApp Cloud API, logs, reminder jobs
│   │   │   └── settings/
│   │   └── routes/             public, auth, me (customer), staff, admin, manage, analytics
│   └── tests/                  Vitest + Supertest (unit + integration)
└── client/                     Angular 21 (standalone, signals, zoneless) + Tailwind v4
    ├── public/images/          drop the salon photographs here (see README inside)
    └── src/
        ├── styles.css          design system (tokens, buttons, inputs, cards, badges, tables, calendar)
        └── app/
            ├── core/           api, auth (+guards/interceptor), realtime, toasts, formatting
            ├── shared/         UI kit, chart, loyalty card, QR scanner, live slot picker
            ├── public/         home, services, booking, manage booking, about, gallery, contact, auth
            ├── account/        customer dashboard
            ├── staff/          employee day, QR check-in
            └── admin/          overview, availability, appointments, CRM, team, services, loyalty, system
```

## 2. Technologies

| Layer | Stack |
|---|---|
| Frontend | Angular 21 (standalone components, signals, zoneless), Tailwind CSS v4, Chart.js, jsQR (camera scanning), socket.io-client |
| Backend | Node.js 24, Express 5, TypeScript, Zod validation, Pino logging, Helmet, rate limiting |
| Database | PostgreSQL 16, Prisma ORM 6, `btree_gist` exclusion constraint |
| Auth | JWT (Bearer), bcrypt password hashing, role- and permission-based access control |
| Real-time | Socket.IO (`availability:changed` broadcast, `appointment:changed` for staff only) |
| Other | Luxon (Africa/Casablanca time), `qrcode`, Nodemailer, WhatsApp Business Cloud API |

## 3. Database architecture

All tables have primary keys, foreign keys, indexes and timestamps. Instants are stored as `timestamptz` (UTC). Times of day are stored as minutes since midnight in the salon timezone.

| Table | Purpose / key constraints |
|---|---|
| `users`, `roles`, `permissions`, `role_permissions` | accounts and RBAC (ADMIN, MANAGER, EMPLOYEE, CUSTOMER) |
| `customers` | unique `phone` (E.164), unique `customerNumber`, unique opaque `qrToken` |
| `employees`, `employee_services` | team members and the services each one is qualified for |
| `service_categories`, `services` | catalogue (price in MAD, duration, image, active flag) |
| `opening_hours`, `salon_closures` | salon hours per weekday, public holidays |
| `working_hours` (unique employee+weekday), `breaks` | weekly schedules |
| `employee_absences`, `availability_exceptions` | days off and holidays; special hours and temporary unavailability |
| `appointments`, `appointment_history` | bookings (price snapshot, status, unique `reference`) and their full history |
| `loyalty_cards`, `loyalty_stamps` | **unique `appointmentId`** on stamps, so one appointment can never earn two stamps |
| `loyalty_rules` | configurable milestones (stamps, % discount, validity) |
| `loyalty_rewards` | **unique (card, rule, cycle)**, so each milestone is issued once per cycle |
| `reward_redemptions` | **unique `rewardId` and `appointmentId`**: one use per reward, one discount per appointment |
| `payments` | gross, discount and net amount; payment method |
| `notifications` | channel, type, delivery status (`SENT`, `FAILED`, `NOT_CONFIGURED`…), dedupe key |
| `audit_logs` | who did what, when, from which IP |
| `salon_settings` | business details, booking rules, cancellation policy, loyalty settings |

### How double bookings are prevented

1. Each booking runs in a transaction that takes a Postgres advisory lock (`pg_advisory_xact_lock`) on the employee's calendar.
2. Inside the lock, the availability engine re-checks opening hours, working hours, breaks, absences, exceptions, the service duration, buffers and existing appointments.
3. As a last line of defence, the database itself rejects overlapping active appointments for the same employee:
   `EXCLUDE USING gist ("employeeId" WITH =, tstzrange("startAt","endAt") WITH &&) WHERE status IN (PENDING, CONFIRMED, COMPLETED)`.

The test suite fires 8 simultaneous bookings at the same slot. Exactly one succeeds and seven receive `409 SLOT_UNAVAILABLE`.

### Timezone handling

The server computes all local times with Luxon on up-to-date tz data, including Morocco's switch to UTC+0 during Ramadan. Some browsers ship stale timezone data; Chromium treats Casablanca as UTC+0 all year, for example. To avoid wrong times, `/api/public/settings` publishes the salon timezone's UTC-offset transitions, and the client applies them instead of relying on the browser.

## 4. Installation

Prerequisites: Node.js ≥ 20 (tested on 24), npm, and Docker Desktop (or your own PostgreSQL ≥ 14).

```bash
cd nea-studio
cp server/.env.example server/.env      # then set JWT_SECRET (see the command in the file)
npm run setup                            # installs deps, starts Postgres, runs migrations and seed
npm run dev                              # API on :4000, web on http://localhost:4200
```

If you already run PostgreSQL elsewhere, skip Docker: point `DATABASE_URL` and `TEST_DATABASE_URL` at it, then create both databases.

## 5. Environment variables (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | separate database **wiped by the tests**; its name must contain `test` |
| `JWT_SECRET` | ✔ | ≥ 32 random characters |
| `JWT_EXPIRES_IN` | | session length (default `12h`) |
| `PORT` | | API port (default 4000) |
| `CORS_ORIGIN` | | allowed web origins, comma-separated |
| `PUBLIC_APP_URL` | | used in notification links |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed | first administrator (change before seeding production) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | email | SMTP provider credentials (e.g. Brevo, Mailgun, SES, Gmail SMTP) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_API_VERSION` | WhatsApp | Meta WhatsApp Business Cloud API |
| `JOBS_ENABLED`, `REMINDER_HOURS_BEFORE` | | reminder and expiry jobs (every 5 min) |

**Notifications are never faked.** When a channel isn't configured, its messages are stored with status `NOT_CONFIGURED`, and the dashboard (*Notifications*, *Settings*) says so.

To enable WhatsApp:
1. Create a Meta Business app with WhatsApp.
2. Note the phone-number ID and a permanent access token.
3. Get a **message template** approved with a single body variable `{{1}}`. The system puts the message text in it, because business-initiated messages must use templates.
4. Set the five `WHATSAPP_*` variables.

## 6. Database & migrations

```bash
cd server
npm run db:deploy     # apply migrations (production / CI)
npm run db:migrate    # create + apply a new migration after editing schema.prisma (dev)
npm run db:seed       # base data + demo data (demo is skipped if employees already exist)
SEED_DEMO=false npm run db:seed   # base data only (roles, permissions, settings, admin)
npm run db:reset      # DROP and recreate the dev database, then seed — destructive
```

## 7. Development commands

| Command | Where | What |
|---|---|---|
| `npm run dev` | root | API (watch) + Angular dev server, with a proxy for `/api`, `/uploads` and `/socket.io` |
| `npm run dev` | server | API only |
| `npm start` | client | web only (`ng serve`) |
| `npm run typecheck` | server | TypeScript check |
| `npm run build` | root | compile the API to `server/dist` and the web app to `client/dist/client/browser` |

## 8. Demo credentials (local demo data only)

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@neastudio.demo` | `NeaAdmin!2026` (from `SEED_ADMIN_PASSWORD`) |
| Manager | `salma@neastudio.demo` | `NeaStaff!2026` |
| Employee | `imane@` / `nadia@` / `yasmine@neastudio.demo` | `NeaStaff!2026` |
| Customer | `customer@neastudio.demo` | `NeaClient!2026` |

These accounts exist only in seeded demo data. Never use them in production: seed production with `SEED_DEMO=false` and a strong `SEED_ADMIN_PASSWORD`.

## 9. Testing

```bash
docker compose up -d db
cd server && npm test
```

The test database (`nea_studio_test`) is created by the Docker init script. Migrations are applied with `prisma migrate deploy`, and each test file truncates its tables. **39 tests** cover:

- **Availability engine:** working hours, breaks, absences, closures, special hours, temporary unavailability, buffers, service duration, off-grid gaps, timezone.
- **Booking:** a successful booking, conflicts, breaks, out-of-hours and absent employees, qualifications, "any employee" fallback, notice and advance window, 8 simultaneous attempts, the DB exclusion constraint, guest cancellation, the cancellation window, rescheduling and history.
- **Loyalty:** one stamp per completion, concurrent double validation, no stamps for cancellations or no-shows, 20 % at 8 and 50 % at 16, configurable rules, discount computed on the server, single redemption, foreign and expired rewards, manual adjustments with audit, QR lookup.
- **Security:** bad credentials, tampered tokens, anonymous access, customer/employee/manager restrictions, data isolation between customers, employees limited to their own appointments, backend validation, account claim.

End-to-end flows (public booking → account → admin calendar → staff scan) were also run in Chromium with Playwright during development.

## 10. Deployment

1. **Database:** a managed PostgreSQL (Neon, Supabase, RDS, Scaleway…). The `btree_gist` extension must be allowed; it is on all major providers. Run `npm run db:deploy`, then `SEED_DEMO=false npm run db:seed`.
2. **API:** `npm run build --prefix server`, then run `node dist/index.js` (keep `node_modules`; the seed needs `tsx` or a compiled copy) behind HTTPS on Render, Railway, Fly.io or a VPS with PM2 + Nginx. Set `NODE_ENV=production`, the secrets and `CORS_ORIGIN`. Persist the `server/uploads/` directory, or switch uploads to object storage.
3. **Web:** `npm run build --prefix client` produces static files in `client/dist/client/browser`. Serve them from Nginx/Netlify/Vercel with an SPA fallback to `index.html`, and reverse-proxy `/api`, `/uploads` and `/socket.io` (WebSocket upgrade) to the API.
4. **HTTPS is required** for the phone-camera QR scanner (`getUserMedia`).

## Replacing demo data

1. **Settings:** salon name, address, phone, email, Instagram, opening hours, closures, booking and cancellation rules.
2. **Services & prices:** edit each demo service (or delete it) and assign the qualified team members.
3. **Team & schedules:** real names, photos, logins, weekly hours, breaks, absences.
4. **Loyalty:** check the milestones (default: 8 stamps → 20 %, 16 → 50 %, valid 90 days).
5. **Photos:** drop the salon photographs into `client/public/images/` (file names in the README there).
6. To start clean, run `npm run db:reset` and then `SEED_DEMO=false npm run db:seed` on a fresh database.

## Key workflows

- **Book without an account:** customers book with their phone number. The confirmation page offers to open a loyalty account using the booking reference + phone (`/account/create`).
- **Manage a booking without an account:** `/booking/manage` with the reference + phone number.
- **Check-in:** staff open *Scan QR code* and scan the customer's QR code (or search by hand). They see today's appointment, optionally apply an available reward and a payment method, then validate. The appointment becomes completed, the payment is recorded, the stamp is added once, and newly unlocked rewards are notified.
- **Live calendar:** *Availability* offers Day, Week, Month and Timeline views with one column per employee. Click a free (green) slot to book it, or click an appointment to manage it. The smart search finds the earliest slot and suggests options per team member. Every change anywhere (public site, staff, other managers) refreshes it over WebSockets.
