# Backend — Django + Django REST Framework

The server side of AbsenInn (Phase 3–9). It verifies every request's Supabase JWT, enforces
company and role rules itself, and owns all business logic: attendance, leave, tasks, the
payroll engine, analytics and reminders. The frontend talks to it at `API_BASE_URL` (default `/api`).

## Quick start (local)

```bash
cd AbsenInn
cp .env.example .env            # fill DATABASE_URL + SUPABASE_* (see database/README.md)
pip install -r backend/requirements.txt
cd backend
python manage.py runserver 8000 # API at /api, frontend at http://localhost:8000
```

`SERVE_FRONTEND=True` (default) makes Django serve `../frontend`, so the UI and API share one
origin: no CORS setup, and camera/GPS work on `localhost`. Then set `MODE: 'production'` in
`frontend/js/config.js`. `manage.py migrate` is **not** needed: the schema belongs to
`database/migrations/*.sql`, and every model uses `managed = False`.

## Layout

| App | Contents |
|---|---|
| `config/` | settings (env-driven), URLs, WSGI |
| `core/` | Supabase JWT auth (`auth.py`), permissions, error envelope, JSON renderer, company time helpers (`context.py`), Storage client (`storage.py`), Auth admin invite (`supabase_admin.py`), audit + notification helpers (`events.py`), test runner (`testing.py`) |
| `accounts/` | company, profiles, settings (`/settings/…`), `/auth/me/`, audit log |
| `employees/` | employee CRUD, activation, employment history, invitation of login accounts |
| `attendance/` | check-in/out (selfie + GPS, Haversine), monitoring, corrections, reconciliation, evidence (signed URLs) |
| `leave_management/` | leave types, requests (with attachment upload), approve/reject/cancel, quota balance |
| `task_management/` | tasks, single assignee, status/progress, history (written by a DB trigger) |
| `payroll/` | **payroll engine** (`engine.py`), workflow, adjustments, payments, salary configurations, payslip PDF (`pdf.py`) |
| `analytics/` | performance analytics (server port of `frontend/js/core/metrics.js`) |
| `notifications/` | in-app notifications, announcements, **scheduled reminders** (`reminders.py`, `manage.py send_reminders`) |

## Security model

* **Authentication**: `Authorization: Bearer <Supabase access token>`. Asymmetric tokens (ES256/RS256,
  current Supabase default) are verified against `SUPABASE_URL/auth/v1/.well-known/jwks.json`.
  Legacy HS256 tokens are verified with `SUPABASE_JWT_SECRET`. The audience must be `authenticated`
  and the token must not be expired.
* **Identity** comes from `public.profiles` (role, company) — never from token metadata. Inactive
  profiles, and employees who are inactive or unlinked, get `403`.
* **Authorization** happens in every service function: rows are always filtered by `company_id`;
  employees only see their own records; salary data is hidden from employees until a period is
  approved; ids from another company return `404` (they are never confirmed to exist).
* Django connects as the trusted `postgres` role (RLS is bypassed for the table owner), so it
  must authorize everything itself — which the tests check. The database triggers still apply:
  for task updates Django passes the acting user (`core/db.py`), so trigger-written history has
  the right actor.
* **Files**: private buckets only. Uploads are checked by magic bytes (JPEG/PNG/WebP selfies ≤ 2 MB,
  PDF/JPG/PNG attachments ≤ 5 MB). Reads use signed URLs valid for 5 minutes.
* The service-role key stays on the server and is used only for Storage and invitations.

## Endpoints (prefix `/api`)

| Area | Endpoints |
|---|---|
| Auth & settings | `GET auth/me/` · `GET settings/` · `PUT settings/{company,work,attendance,payroll,leave,notifications,profile_fields}/` · `GET audit-logs/?limit=` · `GET health/` |
| Employees | `GET/POST employees/` · `GET/PUT/DELETE employees/{id}/` (DELETE = deactivate) · `POST employees/{id}/activate/` |
| Attendance | `GET attendance/history/` · `GET attendance/monitoring/?date=` · `GET attendance/today/` · `POST attendance/location-preview/` · `POST attendance/check-in/` · `POST attendance/check-out/` · `GET attendance/{id}/` · `GET attendance/{id}/evidence/` · `POST attendance/{id or new}/correction/` · `GET/POST attendance/correction-requests/` · `POST attendance/correction-requests/{id}/{approve,reject}/` · `GET/POST attendance/reconcile/` |
| Leave | `GET leave/` · `GET leave/types/` · `POST leave/request/` (JSON or multipart with `attachment`) · `GET leave/{id}/` · `POST leave/{id}/{approve,reject,cancel}/` · `GET leave/{id}/attachment/` · `GET leave/balance/` |
| Tasks | `GET/POST tasks/` · `GET/PUT/DELETE tasks/{id}/` · `PATCH tasks/{id}/status/` |
| Payroll | `GET payroll/` · `POST payroll/generate/` · `GET payroll/{id}/` · `POST payroll/{id}/recalculate/` · `POST payroll/{id}/{submit,approve,schedule,reopen}/` · `POST payroll/{id}/confirm-payment/` · `GET/PATCH payroll/items/{id}/` · `GET payroll/items/{id}/pdf/` · `POST payroll/items/{id}/adjustments/` · `DELETE payroll/items/{id}/adjustments/{adj}/` · `GET payroll/salary-configurations/` · `PUT payroll/salary-configurations/{employee_id}/` · `GET payroll/my-payslips/` · `GET payroll/employees/{id}/items/` |
| Analytics | `GET analytics/performance/?range=this_month\|last_month\|last_90[&employee_id=]` |
| Notifications | `GET notifications/` · `GET notifications/unread-count/` · `POST notifications/{id}/read/` · `POST notifications/read-all/` · `GET/POST announcements/` · `DELETE announcements/{id}/` · `POST cron/reminders/` (header `X-Cron-Secret`) |

Errors always look like `{"detail": "…", "code": "VALIDATION", "<field>": "<message>"}`.
Validation errors return `422`, conflicts (already checked in, already decided, locked payroll)
return `409`, and storage failures return `502 UPLOAD_FAILED` (nothing is recorded, so the user can retry).

## Payroll engine (Firzzzy Store rules)

Every rule comes from **Settings → Payroll** and the leave types; nothing is hard-coded.

* **Payday = join date** (`payment_day_mode = join_date`): each employee is paid on the day of the
  month they joined, or on the last day of the month if it is shorter. The payroll for month M
  covers the cycle from the payday in M−1 to the day before the payday in M.
  Example: joined on the 20th → paid on 20 Nov for 20 Oct – 19 Nov.
* **Daily rate** = basic salary ÷ scheduled working days in the cycle.
* **Absent without notice** (`absent = prorate`) deducts 1 daily rate per day.
* **Unpaid leave** (`unpaid_leave = prorate`) deducts 1 daily rate per day of leave whose type is
  *not paid*, or ½ for a half-day leave.
* **Late** is not deducted (`late_per_incident = 0`). It is counted and shown in the calculation note.
* **Overtime per hour**: whole hours after the scheduled end time (or all whole hours on a
  non-working day) × the employee's hourly rate. Days marked *Perlu Review* are excluded until
  the owner reviews them. The owner can override the hours per item.
* Working days with no record are **never** deducted automatically. They show up as a warning so
  the owner reconciles them first. Cycles that haven't finished yet are flagged too.
* The flow is Draft → Menunggu Approval → Disetujui → (Terjadwal) → **Dibayar**. *Dibayar* is set only
  when the owner confirms the manual transfer. Employees see their slip only after approval.

## Reminders

`python manage.py send_reminders` (or `POST /api/cron/reminders/` with `X-Cron-Secret`) should run
every 15–30 minutes during the day. It is idempotent: each reminder goes to each person at most
once per day. It covers not checked in, forgot to check out, unreconciled yesterday (owner), task
deadlines (tomorrow, today, missed), paydays today/tomorrow and approved-but-unpaid salaries (owner).
Each group can be switched off in Settings → Notifikasi.

## Tests

```bash
cd backend
python manage.py test        # 77 tests, needs a PostgreSQL role that may create databases
```

The test runner builds the test database from the **real** `database/schema.sql`, plus
`tools/supabase_shim.sql`, which emulates `auth.users`/`auth.uid()`/`storage.*` on plain
PostgreSQL. So constraints, triggers and guard functions are exercised as in production. Time is
frozen with `core.testing.frozen()`. Supabase HTTP calls (Storage, invite, JWKS) are tested with mocks.
