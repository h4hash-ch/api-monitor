# API Monitor

A focused API monitoring service built with **Cloudflare Workers, Hono, Supabase PostgreSQL, React, and Vite**.

API Monitor lets users create HTTP/HTTPS monitors, automatically check endpoint health, track response times and failures, detect incidents, view historical statistics, and generate PDF reports.

The backend runs on **Cloudflare Workers**, scheduled monitoring uses **Cloudflare Cron**, and persistent data is stored in **Supabase PostgreSQL**.

![Dashboard](docs/images/dashboard.gif)

---

## Table of Contents

* [Overview](#overview)
* [Problem](#problem)
* [10x Claim](#10x-claim)
* [Core Features](#core-features)
* [Functionalities Implemented](#functionalities-implemented)
* [Architecture](#architecture)
* [Tech Stack](#tech-stack)
* [Project Structure](#project-structure)
* [Prerequisites](#prerequisites)
* [Environment Variables](#environment-variables)
* [Database Setup](#database-setup)
* [Local Development](#local-development)
* [Testing](#testing)
* [Production CI/CD Deployment](#production-cicd-deployment)
* [Production Verification](#production-verification)
* [API](#api)
* [5-Minute Demo](#5-minute-demo)
* [Security](#security)
* [Roadmap Progress](#roadmap-progress)
* [Limitations and Non-Goals](#limitations-and-non-goals)
* [Future Ideas](#future-ideas)

---

# Overview

API Monitor is an authenticated monitoring service for developers, small teams, and API owners who need a simple way to answer:

> **Is my API healthy, and what has happened to it recently?**

Users create monitors by providing an HTTP/HTTPS URL and monitoring interval.

The system periodically performs real HTTP requests and records:

* Availability
* HTTP status
* Response time
* Failure type
* Check history
* Incidents
* Recovery events
* Uptime statistics
* Daily historical statistics

Users can also generate PDF reports for their monitors.

---

# Problem

Developers often check APIs manually when investigating availability or performance problems.

This requires repeatedly checking:

* Whether an endpoint responds
* What status it returns
* How long it takes
* When failures started
* Whether the endpoint recovered
* How frequently failures occurred

Manual checking also makes it difficult to build a useful historical record.

API Monitor automates this workflow by periodically checking endpoints, storing results, detecting incidents, and presenting the information in one place.

---

# 10x Claim

API Monitor aims to make routine API health monitoring and recent reliability analysis at least 10x easier by replacing repeated manual checks and manual history reconstruction with automated monitoring, confirmed incident detection, recovery tracking, and historical statistics.

Instead of manually performing requests and recording results, the system automatically provides:

* Current health
* Recent checks
* Response times
* Failure information
* Incidents
* Recovery events
* Uptime statistics
* Historical trends
* PDF reports

The intended improvement is from **repeated manual checking taking minutes** to **reviewing automatically collected information in seconds**.

---

# Core Features

The capstone is intentionally limited to five core feature areas.

### 1. Monitor Management

Authenticated users can:

* Create monitors
* List their monitors
* View a monitor
* Update monitor configuration
* Delete monitors
* Enable or disable monitoring

Each monitor has a configurable URL and monitoring interval.

A database-enforced quota limits each user to **25 monitors**.

### 2. Automated Monitoring

Cloudflare Cron invokes the Worker scheduler.

The scheduler:

1. Finds monitors that are due.
2. Claims them safely.
3. Performs bounded HTTP checks.
4. Records the result.
5. Updates monitor health.
6. Processes incident transitions.

The scheduler is intentionally bounded by configurable batch and concurrency limits.

### 3. Check History

Each check can record:

* Timestamp
* Success/failure
* HTTP status
* Response time
* Failure type
* Error information
* Execution key

Raw check history is retained for approximately **30 days**.

### 4. Incident Detection

A single failed request does not immediately create an outage.

The monitor state machine is:

```text
HEALTHY
   │
   │ first consecutive failure
   ▼
SUSPECTED_FAILURE
   │
   │ second consecutive failure
   ▼
DOWN
   │
   │ successful check
   ▼
HEALTHY
```

An incident is opened when a monitor reaches `DOWN` and resolved when a later successful check is received.

### 5. Statistics and Reports

The application provides:

* Total checks
* Successful checks
* Failed checks
* Uptime percentage
* Average response time
* Minimum response time
* Maximum response time
* Incident count
* Total downtime
* Daily historical statistics
* PDF reports

---

# Functionalities Implemented


| Concept                    | Where it lives                                        | Evidence                                           |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| **API endpoints**          | Hono routes under `src/`                              | REST API, validation, authentication, status codes |
| **Database**               | `supabase/migration/0001_initial_schema.sql`          | PostgreSQL persistence, indexes, functions, RLS    |
| **Authentication**         | Worker auth middleware + Supabase Auth                | Bearer-token authentication and protected routes   |
| **Background jobs / Cron** | Worker `scheduled()` handler + Wrangler configuration | Automated monitoring and retention                 |
| **Reporting — PDF**        | PDF report service/route                              | Protected PDF report endpoint                      |
| **Caching logic**          | Statistics service                                    | Short-TTL statistics cache                         |
| **Rate limiting / quotas** | API boundary + database functions                     | Request limits and 25-monitor quota                |

**Swaps:** Only 1 (Rate Limiting / quotas)

---

# Architecture

```text
                         Browser
                            │
                            │ HTTPS
                            ▼
              ┌─────────────────────────┐
              │    Cloudflare Worker    │
              │                         │
              │ Hono REST API           │
              │ Authentication          │
              │ Monitor management      │
              │ Statistics              │
              │ PDF reports             │
              │ Cron scheduler          │
              │ Frontend assets         │
              └────────────┬────────────┘
                           │
                           ▼
                 ┌──────────────────┐
                 │     Supabase     │
                 │                  │
                 │ Auth             │
                 │ PostgreSQL       │
                 │ RLS              │
                 └──────────────────┘

                    Cloudflare Cron
                           │
                           ▼
                    Scheduled checks
                           │
                           ▼
                    Monitored APIs
```

### Production model

A single Cloudflare deployment serves:

* React/Vite frontend assets
* Hono API
* Authentication integration
* Monitoring scheduler
* Cron-triggered background work

Supabase provides:

* Authentication
* PostgreSQL persistence
* Row Level Security
* Transactional database functions

---

# Tech Stack

| Technology           | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| React                | Frontend                                         |
| Vite                 | Frontend development/build                       |
| TypeScript           | Type safety                                      |
| Hono                 | Worker API framework                             |
| Cloudflare Workers   | Backend runtime and hosting                      |
| Cloudflare Cron      | Scheduled monitoring                             |
| Supabase Auth        | Authentication                                   |
| Supabase PostgreSQL  | Persistent database                              |
| PostgreSQL functions | Scheduling, state transitions, quotas, retention |
| Row Level Security   | User data isolation                              |
| PDF-lib              | PDF reports                                      |
| Zod                  | Validation                                       |
| Vitest               | Automated testing                                |
| Wrangler             | Cloudflare development and deployment            |

---

# Project Structure

```text
.
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── frontend/
│   ├── ...
│   ├── vite.config.ts
│   └── .env.example
│
├── src/
│   ├── ...
│   └── index.ts
│
├── tests/
│   └── ...
│
├── supabase/
│   └── migration/
│       └── 0001_initial_schema.sql
│
├── docs/
│   └── openapi.yaml
│
├── package.json
├── wrangler.toml.example
├── .dev.vars.example
├── .env.example
└── README.md
```

---

# Prerequisites

Install:

* Node.js 22.12 or newer (required by the current Wrangler and Vitest versions)
* npm
* Git
* A Supabase project
* A Cloudflare account for production deployment

Verify your local installation:

```bash
node --version
npm --version
git --version
```

Wrangler is used through the project's development dependency, so a global Wrangler installation is not required.

---

# Environment Variables

The application separates **browser-safe configuration** from **Worker secrets**. Please refer to all the example files for better understanding.

## Worker variables

The Worker uses:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY

APP_ORIGIN

MAX_SCHEDULE_BATCH
MAX_SCHEDULE_BATCHES
CHECK_CONCURRENCY
STATISTICS_CACHE_TTL_SECONDS
```

Development-only options:

```text
ALLOW_MANUAL_CHECKS
ALLOW_ONE_MINUTE_INTERVAL
```

## Frontend variables

The frontend uses:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_API_BASE_URL
```

The frontend must **never** receive `SUPABASE_SECRET_KEY`.

### Local API URL

For local development:

```text
VITE_API_BASE_URL=http://127.0.0.1:8787/api/v1
```

### Production API URL

For production:

```text
VITE_API_BASE_URL=https://YOUR-WORKER-URL/api/v1
```

Replace `YOUR-WORKER-URL` with the actual deployed Worker URL.

---

# Database Setup

Create a Supabase project and obtain:

```text
Supabase project URL
Supabase publishable key
Supabase secret key
```

Apply the migration:

```text
supabase/migration/0001_initial_schema.sql
```

Apply subsequent numbered SQL migrations in order. In particular,
`supabase/migration/0002_recent_statistics_rpc.sql` is required by the current
statistics API.

You can apply it using the Supabase SQL Editor on Supabase by simply copy/pasting from **.sql** file or may go with your preferred Supabase database workflow.

The migration creates the main tables:

```text
monitors
check_results
incidents
daily_monitor_statistics
```

It also creates the required:

* Indexes
* RLS policies
* Triggers
* Scheduling functions
* Quota functions
* Check transition functions
* Retention/aggregation functions

Verify that the migration completed successfully before starting the Worker.

---

# Local Development

Local development uses **two processes**:

```text
React/Vite
localhost:5173
      │
      │ API requests
      ▼
Cloudflare Worker / Wrangler
127.0.0.1:8787
      │
      ▼
Supabase
```

## 1. Clone and install

```bash
git clone <REPOSITORY_URL>
cd api-monitor
npm install
```

## 2. Configure local environment

Use the repository examples as references:

```text
.dev.vars.example
frontend/.env.example
.env.example
```

Create your local environment files and provide your Supabase development credentials.

Do not commit real credentials ever.

## 3. Start the Worker

Terminal 1:

```bash
npm run dev
```

The Worker normally runs at:

```text
http://127.0.0.1:8787
```

## 4. Start the frontend

Terminal 2:

```bash
npm run dev:web
```

Vite normally runs at:

```text
http://localhost:5173
```

Open:

```text
http://localhost:5173
```

## 5. Test the local workflow

A basic local workflow is:

1. Create an account.
2. Sign in.
3. Create a monitor.
4. View the monitor.
5. Run a development manual check multiple times to populate data.
6. Use publicily available endpoints like **https://http-stat.us/random/200,404?** or **https://http-stat.us/random/200,404,500?** etc, to randomly record the http status multiple times.

8. View statistics on the dashboard.
9. Generate a PDF report.

---

# Local Scheduled Monitoring

Production monitoring is triggered by **Cloudflare Cron**.

Local Wrangler development should not be treated as an exact simulation of deployed Cloudflare Cron behavior.

For local development, the project supports development-only manual checking:

```text
ALLOW_MANUAL_CHECKS=true
```

and optionally:

```text
ALLOW_ONE_MINUTE_INTERVAL=true
```

These settings are for development and testing.

These flags are enabled only in local `.dev.vars`; the deploy workflow does not
copy them to Cloudflare. Because local and deployed Worker credentials point to
the same Supabase project, a local manual check writes into the shared monitor
history even though only the local Worker initiated it.

The production scheduler uses the configured Cloudflare Cron triggers after deployment.

---

# Testing

Run the test suite:

```bash
npm test
```

Build the production application:

```bash
npm run build
```

The test suite covers important application behavior such as:

* Authentication
* Ownership checks
* Validation
* Monitor quotas
* Rate limiting
* Failure transitions
* Incident creation/recovery
* Idempotent transitions
* Statistics
* PDF generation

---

# Production CI/CD Deployment

The repository uses GitHub Actions to verify code and deploy the testing Worker
to Cloudflare. The frontend and API are served by the same Worker, and Cloudflare
continues to run scheduled monitoring after a deployment.

```text
Cloudflare Worker
        │
        ├── React/Vite assets
        ├── Hono API
        └── Cloudflare Cron
                 │
                 ▼
             Supabase
```

There is no separate frontend hosting deployment required. Every push to
`main` audits dependencies, runs tests, TypeScript checks, and a production
build. Only after those steps pass does GitHub Actions deploy the Worker. Pull
requests targeting `main` run verification but do not deploy. A push to `main` updates the
existing testing deployment at `https://10x-api-monitor.apimonitor.workers.dev/`.
The deploy job then retries the Worker's `/health` endpoint and fails if it does
not return `{"status":"ok"}`.

## One-time GitHub setup

In **GitHub → Repository Settings → Secrets and variables → Actions**, add
these repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy permission for the selected Cloudflare account |
| `CLOUDFLARE_ACCOUNT_ID` | Identifies the Cloudflare account to Wrangler |

Create a scoped Cloudflare API token with the Workers deployment permissions
needed for this account. Do not commit it or add it to Supabase settings.

Add these Actions variables. They are browser-visible application configuration,
so they must contain only the Supabase URL, publishable key, and Worker API URL:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | The shared Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The shared project's publishable key |
| `VITE_API_BASE_URL` | `https://10x-api-monitor.apimonitor.workers.dev/api/v1` |

Do not create a GitHub secret or variable for `SUPABASE_SECRET_KEY`. CI tests
and builds do not connect to Supabase. The server-side Supabase credentials stay
in Cloudflare Worker secrets.

## One-time Cloudflare setup

Confirm that the Worker already has these secrets set. If not, authenticate
Wrangler locally and set them once:

```bash
npx wrangler login
npx wrangler whoami
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
```

Use the same Supabase project values already configured locally. The committed
`wrangler.toml` contains non-secret Worker settings, including the production
origin and Cron schedule. The local `npm run dev` command overrides only
`APP_ORIGIN` to allow the local frontend.

## Shared database and migrations

Local development and the deployed testing Worker use the same Supabase
database credentials. Therefore local monitor creation, manual checks, and
other writes affect the same data used by the live testing site. Use a clearly
identified test account and test monitors, and do not use local code that can
delete or corrupt data you need to keep.

GitHub Actions never runs database migrations. Apply each SQL migration to the
shared Supabase project deliberately and once. Before deploying the current
statistics changes, apply
`supabase/migration/0002_recent_statistics_rpc.sql`; the new code calls that
function. Do not push to `main` until this migration is in place.

## Normal workflow

While developing locally, keep using `npm run dev` and `npm run dev:web`. Run
the same checks locally before pushing:

```bash
npm ci
npm test
npm run lint
npm run build
```

Push a branch and open a pull request to run verification without deployment.
After merging to `main`, the successful workflow deploys to Cloudflare. Follow
the run under **GitHub → Actions** and then complete the production verification
steps below. `npx wrangler deploy` remains available as a manually authenticated
fallback, but GitHub Actions is the normal deployment route.

For an extra merge guard, configure a GitHub ruleset or branch protection rule
for `main` that requires the **Test, lint and build** status check to pass.

---

# Production Verification

After deployment, verify the complete system instead of assuming that a successful deployment means everything works.

## 1. Health check

If the health endpoint is enabled:

```bash
curl https://YOUR-WORKER-URL/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## 2. Frontend

Open:

```text
https://YOUR-WORKER-URL
```

Verify:

* Frontend loads.
* Authentication works.
* No API requests point to `localhost`.
* A monitor can be created.
* A monitor can be updated.
* A monitor can be deleted.

## 3. Scheduled monitoring

Create an enabled monitor and allow the Cron scheduler to run.

The production scheduler runs every five minutes:

```text
*/5 * * * *
```

Inspect Worker logs:

```bash
npx wrangler tail YOUR-WORKER-NAME
```

Verify that:

```text
Cron
  ↓
Scheduler
  ↓
Due monitor claimed
  ↓
HTTP request executed
  ↓
Check result stored
  ↓
Monitor state updated
```

## 4. Incident handling

Use a controlled endpoint that can produce failures (refer [here](#5-test-the-local-workflow)).

Verify:

```text
HEALTHY
   ↓
SUSPECTED_FAILURE
   ↓
DOWN
   ↓
Incident opened
   ↓
Successful check
   ↓
HEALTHY
   ↓
Incident resolved
```

## 5. Reports and statistics

Verify:

* Check history
* Statistics
* Cached statistics
* Incident history
* PDF report generation

---

# API

The API is documented in:

```text
docs/openapi.yaml
```

Base path:

```text
/api/v1
```

Protected endpoints use:

```http
Authorization: Bearer <JWT>
```

## Monitors

```text
GET    /api/v1/monitors
POST   /api/v1/monitors
GET    /api/v1/monitors/{id}
PATCH  /api/v1/monitors/{id}
DELETE /api/v1/monitors/{id}
```

## Check history

```text
GET /api/v1/monitors/{id}/checks?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=50
```

Check history and incident lists are paginated. `page` defaults to `1`,
`limit` defaults to `20` and is capped at `100`. Responses contain `data` plus
`meta` (`page`, `limit`, `total`, `hasMore`). Check history date ranges are
limited to 90 days.

## Incidents

```text
GET /api/v1/monitors/{id}/incidents?page=1&limit=50
```

Incident history uses the same pagination response format.

## Statistics

```text
GET /api/v1/monitors/{id}/statistics
```

## PDF report

```text
GET /api/v1/monitors/{id}/report
```

Returns:

```text
application/pdf
```

## Development manual check

```text
POST /api/v1/monitors/{id}/check
```

This endpoint is intended for development/testing and should not be treated as the production scheduling mechanism.

---

# 5-Minute Demo

A stranger should be able to demonstrate the project without additional explanation.

### 1. Open the application

Open the deployed URL or local frontend. Note that in production environment, you can only schedule the checks at minimun 5 mins interval and cannot run them manually on your own. Use local environment if you need to populate as much data as you want in lesser time to observe statistics on dashboard.

### 2. Sign in

Use a demo account or create an account.

### 3. Create a monitor

Provide:

* Name
* HTTP/HTTPS URL
* Monitoring interval

### 4. Show monitoring

Show:

* Current health
* Last check
* Response time
* Check history

### 5. Show an incident

Use a controlled failing endpoint to demonstrate:

```text
HEALTHY → SUSPECTED_FAILURE → DOWN
```

Then restore it:

```text
DOWN → HEALTHY
```

### 6. Show statistics

Demonstrate:

* Uptime
* Response times
* Success/failure counts
* Incidents
* Downtime

### 7. Generate a report

Download the PDF report.

### 8. Explain the architecture

```text
React/Vite
    ↓
Cloudflare Worker + Hono
    ↓
Supabase PostgreSQL

Cloudflare Cron
    ↓
Automated monitoring
```

---

# Security

The project separates browser-safe values from server-side secrets.

## Never commit

Do not commit:

* Supabase secret keys
* API keys
* Passwords
* `.dev.vars`
* Production environment files
* Generated private data

Use environment variables and Cloudflare Worker secrets.

## Supabase secret key

`SUPABASE_SECRET_KEY` must:

* Remain server-side
* Never be exposed through `VITE_*`
* Never be committed
* Never be logged

## Frontend credentials

The frontend may use:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

User data is still protected by authentication, ownership checks, and database RLS.

Authenticated API requests are limited to 60 per minute per user and Worker
isolate. Statistics are limited to 30 per minute; PDF reports and development
manual checks are limited to 5 per minute. Counters are in-memory and isolate-
local, so these are best-effort safeguards rather than a distributed traffic
limit. A shared Cloudflare rate limit binding remains a production-hardening
task. Run `npm audit` when reviewing dependency updates.

The source now configures a Content Security Policy, frame protections, MIME
sniffing protection, a referrer policy, a restrictive Permissions Policy, and
HSTS for frontend and Worker responses. These changes take effect after the
next successful deployment. The frontend CSP allows the same-origin API and
Supabase project endpoints.

Monitor and webhook URLs reject local names and private or reserved IP literals.
Monitor redirects are followed manually, with every destination revalidated
and a five-redirect limit. Webhook redirects are rejected. Cloudflare Workers do
not provide this application with a DNS lookup-and-pin interface, so a hostname
that resolves to a private address cannot be ruled out solely by URL validation;
review the platform's outbound network controls before accepting untrusted
monitor URLs at public scale.

## Data isolation

RLS protects user-owned monitoring data, including:

```text
monitors
check_results
incidents
daily_monitor_statistics
```

---

# Data Retention

Raw check results are retained for approximately **30 days**.

Older data is aggregated into daily statistics before raw records are removed.

This allows the application to retain long-term information without keeping every individual check indefinitely.

Long-term statistics include information such as:

* Check counts
* Uptime
* Response-time statistics
* Incident counts
* Downtime

---

# Limitations and Non-Goals

API Monitor intentionally does not attempt to become a full observability platform.

It does not provide:

* Instant Alert on endpoint's suspected or confirmed failure.
* Distributed tracing
* Log aggregation
* Infrastructure monitoring
* Full APM
* Multi-region monitoring agents
* Billing/subscriptions
* Enterprise organizations
* Mobile applications
* Complex alert routing
* Arbitrary custom metrics

The project focuses on one problem:

> **Simple, automated HTTP/API availability monitoring with useful historical information.**

---

# Future Ideas

Potential future improvements include:

* Alerts through email or other means
* Multi-region monitoring
* Team accounts
* Shared monitors
* Custom alert thresholds
* Response-body assertions
* Expected status-code configuration
* SSL certificate monitoring
* Advanced analytics
* Longer configurable retention
* External incident integrations
* Monitor grouping and tagging

---

# Useful Commands

## Install

```bash
npm install
```

## Local Worker

```bash
npm run dev
```

## Local frontend

```bash
npm run dev:web
```

## Tests

```bash
npm test
```

## Test watch mode

```bash
npm run test:watch
```

## Lint/type validation

```bash
npm run lint
```

## Production build

```bash
npm run build
```

## Wrangler login

```bash
npx wrangler login
```

## Verify Cloudflare account

```bash
npx wrangler whoami
```

## Deploy

Normal deployment happens through GitHub Actions after a successful push to
`main`. This command is a manual fallback:

```bash
npx wrangler deploy
```

## Tail Worker logs

```bash
npx wrangler tail YOUR-WORKER-NAME
```

## Production health check

```bash
curl https://YOUR-WORKER-URL/health
```

---

# Troubleshooting

### Frontend calls `localhost` in production

Check:

```text
VITE_API_BASE_URL
```

It must point to:

```text
https://YOUR-WORKER-URL/api/v1
```

Update the `VITE_API_BASE_URL` Actions variable, then push to `main` after the
verification workflow passes. Use `npx wrangler deploy` only for a manual
fallback.


### Worker reports an invalid Supabase URL

Check:

```text
SUPABASE_URL
```

It should be a valid HTTPS Supabase project URL.

### Monitor creation fails

Inspect Worker logs:

```bash
npx wrangler tail YOUR-WORKER-NAME
```

Then verify that the database migration and monitor creation function were applied successfully.

### Cron appears inactive

Check:

1. Cron configuration in Wrangler.
2. Worker deployment.
3. Worker logs.
4. Monitor is enabled.
5. Monitor has a due `next_check_at`.
6. Production Supabase credentials are configured.

Use:

```bash
npx wrangler tail YOUR-WORKER-NAME
```

---

# Definition of Done

## Problem and scope

* [ ] Problem is clearly documented.
* [ ] Intended users are documented.
* [ ] 10x claim is documented.
* [ ] Core scope is limited.
* [ ] Non-goals are documented.

## Capstone concepts

* [ ] API endpoints
* [ ] Database
* [ ] Authentication
* [ ] Background jobs/Cron
* [ ] PDF reporting
* [ ] Caching
* [ ] Rate limiting/quotas
* [ ] At least five concepts implemented
* [ ] 1 swap used

## Runnable system

* [ ] `npm install` works.
* [ ] Worker starts with `npm run dev`.
* [ ] Frontend starts with `npm run dev:web`.
* [ ] Database migration is documented.
* [ ] Environment variables are documented.
* [ ] Tests run with `npm test`.
* [ ] Production build succeeds.
* [ ] Wrangler deployment works.

## Stranger test

* [ ] A new developer can understand the problem.
* [ ] A new developer can configure the project.
* [ ] A new developer can run it locally.
* [ ] A new developer can follow the 5-minute demo.
* [ ] Production deployment steps are documented.
* [ ] Production Cron execution can be verified.

## Security

* [ ] No secrets are committed.
* [ ] Environment files are ignored.
* [ ] Supabase secret key is server-side only.
* [ ] Protected resources enforce ownership.
* [ ] User data is protected by RLS.
* [ ] No private third-party data is included.

---

# Quick Start

For local development:

```bash
git clone <REPOSITORY_URL>
cd api-monitor
npm ci
```

Configure the local environment and apply:

```text
supabase/migration/0001_initial_schema.sql
```

Start the Worker:

```bash
npm run dev
```

In another terminal, start the frontend:

```bash
npm run dev:web
```

Open:

```text
http://localhost:5173
```

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

For deployment to the testing Worker:

```bash
git push origin main
```

GitHub Actions verifies the change and deploys only when all checks pass. Then
verify the deployed application, API, authentication, scheduled monitoring,
statistics, incidents, and PDF reporting.

---

# Roadmap Progress

The project is live for testing. The roadmap in
[`Further_Implementation.md`](Further_Implementation.md) remains the source of
truth for launch scope. Completed work includes paginated check and incident
history APIs, URL destination validation, monitor redirect revalidation,
webhook redirect rejection, and PostgreSQL aggregation for recent
dashboard/report statistics. Daily historical aggregates and short-lived
statistics caching were already present. The first GitHub Actions verification
and testing Worker deployment succeeded. The workflow uses Node.js 22; local
development requires Node.js 22.12 or newer. The current source and lockfile
dependency audit reports no known vulnerabilities; these updates and the new
per-isolate statistics/PDF limits and security headers await the next
deployment.

Billing, subscriptions, onboarding, marketing pages, and production
security/load audits remain planned. The successful deployment proves the
Cloudflare GitHub secrets and non-empty frontend Actions variables are
available. It does not prove that the shared Supabase migration is applied or
that deployed application flows work; complete the post-deployment checks in
[`Further_Implementation.md`](Further_Implementation.md), including
`/health`, authentication, monitor creation, scheduled checks, incidents,
pagination, statistics, and PDF reports.

---

# Capstone Summary

API Monitor is a scoped backend-focused solution for automated API health monitoring.

It implements all seven original capstone concepts:

1. API endpoints
2. Database
3. Authentication
4. Background jobs / Cron
5. PDF reporting
6. Caching
7. Rate limiting / quotas

**Swaps:** 1.

**Core problem:** Reduce the manual effort required to determine whether an API is healthy and understand its recent history.

**Non-goal:** Building a full multi-region observability platform.

The project demonstrates an end-to-end progression from:

```text
Problem
   ↓
Walking skeleton
   ↓
API + database
   ↓
Authentication
   ↓
Scheduled monitoring
   ↓
Incident detection
   ↓
Statistics + caching
   ↓
PDF reporting
   ↓
Quotas
   ↓
Production deployment
```

The goal is a **small, understandable system that runs end-to-end and demonstrates the capstone concepts clearly**.
