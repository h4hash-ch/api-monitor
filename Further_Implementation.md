# API Monitor — Further Development & Launch Roadmap

> **Project:** API Monitor — Automated API Health Monitoring Platform

> **Status:** Functional MVP / Live for limited testing; paid public launch is not ready

> **Primary Stack:** TypeScript, Hono, React, Cloudflare Workers, Cloudflare Cron, Supabase PostgreSQL, Vitest, PDF-lib

> **Billing:** To be implemented

> **Testing deployment:** https://10x-api-monitor.apimonitor.workers.dev/

## Implementation progress (2026-10-09)

The project is live for testing. This implementation pass added:

* URL checks that reject local/private IP literals and local hostnames for
  monitored targets and HTTPS webhook destinations.
* Manual redirect handling for monitor checks, revalidating every hop with a
  five-redirect limit; webhook delivery rejects redirects.
* Paginated check and incident history APIs (maximum 100 rows) with total and
  `hasMore` metadata. The current dashboard loads the first 100 rows.
* Check history query validation for valid dates and reporting windows up to
  90 days.
* Recent dashboard/report statistics are aggregated in PostgreSQL by the new
  `0002_recent_statistics_rpc.sql` migration, avoiding transfer of every raw
  check into the Worker.
* Added GitHub Actions verification for pull requests and pushes to `main`,
  with deployment to the existing testing Worker gated on passing tests,
  type checks, and build.
* Made `wrangler.toml` source-controlled without secrets. Local Worker startup
  overrides the production origin so local frontend requests continue to work.
* CI/CD is now confirmed operational: the supplied logs show verification and
  deployment of version `d44721f7-7e42-4961-8639-517b303412e2` to the testing
  Worker. Runtime verification and the shared database migration remain open.
* Upgraded vulnerable dependencies after the CI run reported nine advisories;
  `npm audit` now reports zero known vulnerabilities. Node.js 22.12 or newer is
  required by the current Vitest version.
* Added `npm audit --audit-level=moderate` to CI so future moderate, high, or
  critical dependency advisories block verification and deployment.
* Added a post-deployment `/health` smoke check with retries; broader browser,
  authentication, monitor, statistics, and report checks still require review.
* Added lower per-user, per-isolate limits for statistics (30/minute), PDF
  reports (5/minute), and development manual checks (5/minute), and periodically
  removes expired counters. Distributed rate limiting remains outstanding.
* Added a frontend Content Security Policy and standard browser security headers
  through Cloudflare's static-asset `_headers` file, with matching security
  headers on Worker-generated API responses.

Daily retention aggregates and statistics caching existed before this pass.
Cloudflare Workers do
not provide this implementation with a DNS lookup-and-pin interface; SSRF
protection is therefore partial until outbound DNS/network policy is verified.
No deployment has been performed.

---

## 1. Project Objective

Transform the current functional API monitoring MVP into a production-ready SaaS platform capable of:

* Paid subscriptions
* Multiple pricing tiers
* Scalable API monitoring
* Reliable incident detection and recovery
* Long-term statistics
* Customer dashboards
* Team/workspace support
* Professional onboarding
* Public marketing website
* Documentation
* Search-engine-friendly content
* Conversion-focused landing pages
* Production security and observability

The current monitoring engine is already a strong foundation. The next stage should focus on **productization, scalability, frontend experience, billing, content, and launch readiness**.

---

# 2. Backend / Core Platform

## 2.1 Subscription & Billing System

### Implement subscription architecture

Create:

* `plans`
* `subscriptions`
* `entitlements`

Recommended conceptual relationship:

```text
User / Account
      |
      v
Subscription
      |
      v
Plan
      |
      v
Entitlements
```

### Plan configuration should control:

* Maximum monitors
* Minimum monitoring interval
* Data retention
* Maximum team members
* PDF reports
* Email alerts
* Webhooks
* Advanced statistics
* API access
* Custom headers
* Response validation
* Incident history
* Other future features

Do not hard-code limits such as `25 monitors` throughout the application.

Instead:

```text
Plan
  ↓
Entitlement
  ↓
Database enforcement
```

---

## 2.2 Stripe Integration

Implement:

* Stripe Checkout
* Stripe Customer creation
* Subscription creation
* Subscription cancellation
* Upgrade
* Downgrade
* Billing portal
* Invoice history
* Payment failure handling
* Subscription renewal
* Trial handling if introduced

### Required webhook events

At minimum handle:

* `checkout.session.completed`
* `customer.subscription.created`
* `customer.subscription.updated`
* `customer.subscription.deleted`
* Relevant invoice/payment failure events

### Important

Stripe should remain the billing authority.

Supabase should store the application's current subscription/entitlement state.

Do not call Stripe for every API request.

Recommended flow:

```text
Stripe
   |
   | webhook
   v
Cloudflare Worker
   |
   v
Supabase subscriptions
   |
   v
Application entitlement checks
```

---

# 3. Account / Workspace Architecture

The current system is primarily user-oriented.

Before significant commercial adoption, consider introducing:

```text
accounts / workspaces
```

Recommended future architecture:

```text
User
 |
 +---- Account
         |
         +---- Members
         |
         +---- Subscription
         |
         +---- Monitors
                  |
                  +---- Checks
                  +---- Incidents
                  +---- Statistics
```

This will make future features easier:

* Team members
* Multiple users
* Roles
* Organizations
* Shared monitors
* Company billing
* Team dashboards

Recommended roles:

```text
Owner
Admin
Member
Viewer
```

This does not need to be implemented immediately if launch is initially individual-user focused, but the database should avoid making a future migration unnecessarily difficult.

---

# 4. Monitoring Scalability

## Current Architecture

Current monitoring model:

```text
Cloudflare Cron
       |
       v
Claim due monitors
       |
       v
Concurrent checks
       |
       v
Supabase
```

This is appropriate for the current MVP.

---

## Future Architecture

At larger customer volume:

```text
Cron
 |
 v
Scheduler
 |
 v
Queue
 |
 +---- Worker A
 |
 +---- Worker B
 |
 +---- Worker C
 |
 v
Check results
 |
 v
Supabase
```

Consider introducing a queue only when monitoring volume justifies it.

Do not over-engineer the MVP before there is real workload.

---

# 5. Database / Statistics Optimization

## High Priority

Avoid loading the entire 30-day raw check history into Cloudflare Workers to calculate dashboard statistics.

Current conceptual flow:

```text
Dashboard
    |
    v
Load raw checks
    |
    v
Worker calculates statistics
```

Target architecture:

```text
Dashboard
    |
    v
Aggregated statistics
    |
    v
Small PostgreSQL result
```

---

## Recommended Data Layers

```text
Raw checks
    |
    | recent history
    v
check_results

Hourly aggregation
    |
    v
hourly_monitor_statistics

Daily aggregation
    |
    v
daily_monitor_statistics
```

The hourly layer is optional initially.

Daily aggregation should remain the long-term historical layer.

---

# 6. Raw Data Retention

Keep the existing concept of:

```text
Raw checks → approximately 30 days
```

After retention:

```text
Raw checks
    |
    v
Aggregate
    |
    v
Daily statistics
    |
    v
Delete old raw records
```

Preserve:

* Uptime
* Downtime
* Response time
* Successful checks
* Failed checks
* Incident count
* Incident duration
* Availability percentage

Do not unnecessarily store large response bodies.

---

# 7. Database Scaling Improvements

Monitor:

* Database CPU
* Memory
* Disk usage
* Connections
* Query latency
* Slow queries
* WAL growth
* Raw check table size
* Index size
* Retention job duration

When raw check volume becomes large, consider:

* PostgreSQL partitioning
* Bulk inserts
* Batch aggregation
* More efficient indexes
* Queue-based processing
* Dedicated worker architecture

Do not introduce partitioning until actual workload justifies the complexity.

---

# 8. API Improvements

Review every API endpoint for:

* Authentication
* Authorization
* Input validation
* Ownership
* Rate limiting
* Pagination
* Consistent errors
* Caching
* Response format
* API versioning

Recommended response format:

```json
{
  "data": {},
  "error": null,
  "meta": {}
}
```

Use consistent error codes:

```text
AUTH_REQUIRED
FORBIDDEN
VALIDATION_ERROR
MONITOR_LIMIT_REACHED
SUBSCRIPTION_REQUIRED
RATE_LIMITED
NOT_FOUND
INTERNAL_ERROR
```

---

# 9. API Pagination

Ensure endpoints returning lists support pagination.

Examples:

```text
GET /monitors?page=1&limit=20
GET /incidents?page=1&limit=20
GET /checks?page=1&limit=100
```

Do not return unlimited database rows.

---

# 10. Caching

Continue using short-lived caching where appropriate.

Potential cache targets:

* Dashboard statistics
* Monitor summaries
* Historical statistics
* Public status pages
* Documentation metadata

Do not cache:

* Authentication state
* Sensitive user information
* Real-time incident transitions
* Billing state without appropriate invalidation

---

# 11. Frontend — Major Development Required

The current frontend should be expanded significantly before public launch.

The application needs to feel like a **real SaaS product**, not only a functional technical dashboard.

Recommended frontend areas:

```text
Public Website
 |
 +-- Home
 +-- Features
 +-- Pricing
 +-- Use Cases
 +-- Documentation
 +-- Blog
 +-- Status
 +-- About
 +-- Contact
 |
 v
Application
 |
 +-- Dashboard
 +-- Monitors
 +-- Monitor Details
 +-- Incidents
 +-- Statistics
 +-- Reports
 +-- Settings
 +-- Billing
 +-- Account
```

---

# 12. Public Landing Page

Create a professional homepage.

## Hero Section

Clearly explain:

> Monitor your APIs before your users discover they're down.

Include:

* Short value proposition
* Primary CTA
* Secondary CTA
* Product screenshot
* Monitoring visualization

Example CTA structure:

```text
Start Monitoring
View Pricing
```

Avoid vague marketing language.

The visitor should immediately understand:

1. What the product does
2. Who it is for
3. Why it is useful
4. What they should do next

---

# 13. Homepage Sections

Recommended homepage structure:

```text
Hero
   ↓
Trusted / Product statement
   ↓
Problem
   ↓
How it works
   ↓
Key features
   ↓
Dashboard preview
   ↓
Incident detection explanation
   ↓
Statistics / reporting
   ↓
Use cases
   ↓
Pricing preview
   ↓
FAQ
   ↓
Final CTA
```

---

# 14. Feature Pages

Create dedicated pages for major features.

Examples:

```text
/features/api-monitoring
/features/uptime-monitoring
/features/incident-monitoring
/features/api-health-checks
/features/response-time-monitoring
/features/api-alerting
/features/api-reports
/features/api-statistics
```

Each page should contain:

* Problem
* Solution
* Feature explanation
* Screenshots
* Example workflow
* Benefits
* FAQ
* CTA

This also creates useful SEO landing pages.

---

# 15. Use-Case Pages

Create pages targeting different audiences.

Examples:

```text
/use-cases/developers
/use-cases/startups
/use-cases/saas
/use-cases/backend-teams
/use-cases/devops
/use-cases/agencies
/use-cases/api-providers
```

Explain how each audience can use the platform.

---

# 16. Dashboard Improvements

The dashboard should immediately answer:

> "Are my APIs healthy right now?"

Recommended dashboard components:

### Overview cards

```text
Monitors
Healthy
Degraded
Down
Uptime
Active Incidents
```

### Monitor status

```text
API Name       Status       Response Time
------------------------------------------
Payments       Healthy      142 ms
Auth           Healthy      98 ms
Users          Degraded     612 ms
Orders         Down         —
```

### Recent incidents

Display:

* Monitor
* Started
* Duration
* Status
* Cause

---

# 17. Monitor Details Page

Create a much richer monitor details page.

Recommended sections:

```text
Monitor Header
    |
    +-- Current status
    +-- Response time
    +-- Uptime
    +-- Last checked
    |
    +-- Response-time graph
    |
    +-- Uptime graph
    |
    +-- Check history
    |
    +-- Incidents
    |
    +-- Configuration
```

Provide clear visual states:

```text
Healthy   → Green
Degraded  → Yellow
Down      → Red
Unknown   → Gray
```

---

# 18. Statistics Visualization

Introduce charts for:

* Uptime percentage
* Response time
* Average response time
* Minimum response time
* Maximum response time
* Failed checks
* Incident duration
* Downtime
* Daily availability

Time ranges:

```text
24 Hours
7 Days
30 Days
90 Days
1 Year
```

Where historical retention allows it.

---

# 19. Incident Experience

Incidents should have their own page.

Display:

```text
Incident #123

Monitor:
Payments API

Status:
Resolved

Started:
10:42 UTC

Resolved:
10:51 UTC

Duration:
9 minutes

Detection:
2 consecutive failures

Recovery:
Successful health check
```

Add a visual incident timeline.

---

# 20. Notification System

Implement notification preferences.

Possible channels:

```text
Email
Webhook
Slack
Discord
Microsoft Teams
```

Initially prioritize:

1. Email
2. Webhook

Additional integrations can follow.

Allow configuration such as:

```text
Notify when monitor goes down
Notify when monitor recovers
Notify after X failures
Notify only during specific hours
```

---

# 21. Settings

Create a proper settings area.

Sections:

```text
Profile
Security
Notifications
API Keys
Billing
Team
Danger Zone
```

---

# 22. API Keys

If programmatic access is planned, implement:

```text
API Keys
   |
   +-- Create
   +-- Revoke
   +-- Last used
   +-- Created date
```

Never display the complete secret again after creation.

Store hashed keys where appropriate.

---

# 23. Billing UI

Create:

```text
Settings → Billing
```

Display:

```text
Current Plan
Usage
Next Billing Date
Subscription Status
Payment Status
```

Example:

```text
PRO

18 / 25 monitors

████████████████░░░░░

5-minute monitoring
30-day raw history

[Manage Subscription]
```

---

# 24. Usage Dashboard

Show customers exactly what they are consuming.

Track:

```text
Monitors
Monitoring checks
API requests
Reports
Team members
Storage
```

This will also reduce confusion around plan limits.

---

# 25. Onboarding

Build an onboarding flow for new users.

Recommended:

```text
Create Account
     ↓
Welcome
     ↓
Create First Monitor
     ↓
Choose Check Interval
     ↓
Configure Notifications
     ↓
First Successful Check
     ↓
Dashboard
```

The user should be able to reach:

> "My first API is being monitored"

within a few minutes.

---

# 26. Empty States

Every dashboard section needs meaningful empty states.

Bad:

```text
No data.
```

Better:

```text
You don't have any monitors yet.

Add your first API and we'll start checking it automatically.

[Add Monitor]
```

Do this for:

* Monitors
* Incidents
* Reports
* Notifications
* API keys
* Team members

---

# 27. Loading States

Add:

* Skeleton loaders
* Button loading states
* Chart loading states
* Table loading states
* Retry states

Avoid blank screens while API requests are running.

---

# 28. Error States

Create user-friendly error messages.

Instead of:

```text
500 Internal Server Error
```

display:

```text
We couldn't load your monitors.

Please try again.

[Retry]
```

Log technical information separately.

---

# 29. Responsive Design

The dashboard should work properly on:

* Desktop
* Laptop
* Tablet
* Mobile

Prioritize desktop for developers, but do not allow mobile layouts to break.

---

# 30. Accessibility

Add:

* Keyboard navigation
* Visible focus states
* Proper labels
* Semantic HTML
* Accessible charts
* Color-independent status indicators
* Sufficient contrast
* Screen-reader-friendly controls

Do not communicate status using color alone.

Example:

```text
🟢 Healthy
🟡 Degraded
🔴 Down
```

---

# 31. Design System

Create a reusable design system.

Define:

* Colors
* Typography
* Spacing
* Buttons
* Cards
* Forms
* Tables
* Modals
* Alerts
* Badges
* Charts
* Navigation

This will prevent every page from developing a different visual style.

---

# 32. Marketing Website Content

The current lack of public content is a major area to address before SEO.

Create at minimum:

```text
Home
Features
Pricing
About
Contact
FAQ
Documentation
Blog
Privacy Policy
Terms of Service
Cookie Policy
Security
```

---

# 33. SEO Foundation

Implement technical SEO from the beginning.

For every public page:

* Unique `<title>`
* Unique meta description
* Canonical URL
* Open Graph metadata
* Twitter/X metadata
* Proper heading hierarchy
* Descriptive URLs
* Internal links
* Image alt text
* Structured data where appropriate

Generate:

```text
sitemap.xml
robots.txt
```

---

# 34. SEO Content Strategy

Do not attempt to rank only for:

```text
API monitoring
```

That is highly competitive.

Target long-tail searches such as:

```text
how to monitor an API
API uptime monitoring
REST API monitoring
API health check
API downtime monitoring
API response time monitoring
API monitoring tool
API monitoring for developers
automated API health checks
API availability monitoring
HTTP endpoint monitoring
API incident monitoring
```

Create genuinely useful content around these topics.

---

# 35. Documentation

Build a documentation section.

Recommended structure:

```text
/docs
    /getting-started
    /monitors
    /health-checks
    /incidents
    /statistics
    /notifications
    /reports
    /api
    /authentication
    /billing
    /troubleshooting
```

Documentation can also become a strong SEO surface.

---

# 36. Developer Documentation

Explain:

* REST API
* Authentication
* API keys
* Creating monitors
* Updating monitors
* Retrieving incidents
* Retrieving statistics
* Reports
* Rate limits
* Error codes
* Pagination

Include code examples:

```text
curl
JavaScript
TypeScript
Python
```

---

# 37. Blog / Content Marketing

Create a blog rather than publishing thin SEO pages.

Potential topics:

```text
How API Monitoring Works

What Is API Uptime?

How to Monitor a REST API

What Is an API Health Check?

How to Detect API Downtime

How to Measure API Response Time

What Does 99.9% API Uptime Mean?

API Monitoring vs Application Monitoring

How to Build an API Health Monitoring System

Why Two Consecutive Failures Are Useful for Incident Detection

How API Monitoring Helps SaaS Teams
```

Technical engineering articles can be particularly valuable for attracting developer traffic.

---

# 38. Comparison Pages

Once the product is mature enough, consider legitimate comparison pages.

Examples:

```text
API Monitor vs UptimeRobot
API Monitor vs Better Uptime
API Monitor vs Pingdom
API Monitor vs Checkly
API Monitor vs Postman Monitoring
```

Do not create low-quality pages that simply repeat competitor names.

Each comparison should provide genuine feature and workflow differences.

---

# 39. FAQ Content

Create a comprehensive FAQ covering:

### Product

* What is API monitoring?
* How frequently are APIs checked?
* What happens when an API fails?
* How is downtime calculated?

### Billing

* What happens when I exceed my monitor limit?
* Can I cancel?
* What happens after cancellation?
* Can I upgrade later?

### Technical

* What HTTP methods are supported?
* Are custom headers supported?
* How is authentication handled?
* How long is raw check data stored?
* How are historical statistics preserved?

These FAQs can also support structured data where appropriate.

---

# 40. Public Status Pages

Consider implementing public status pages.

Example:

```text
status.example.com
```

Display:

```text
All Systems Operational

API
████████████████████

Authentication
████████████████████

Payments
████████████████████
```

This can become an additional paid feature.

---

# 41. SEO-Friendly Public Monitor Pages

Potential future feature:

```text
status.company.com
```

or:

```text
app.example.com/status/company
```

Allow customers to publish public service status.

This creates another useful product surface and potentially additional search visibility.

---

# 42. Security Hardening

Before launch:

* Review all RLS policies
* Review ownership checks
* Verify JWT handling
* Verify rate limits
* Verify API key handling
* Validate webhook signatures
* Secure environment variables
* Review CORS
* Review CSP
* Review security headers
* Prevent sensitive information in logs
* Verify PDF generation cannot be abused
* Verify SSRF protections for monitored URLs

---

# 43. SSRF Protection

This is particularly important for an API monitoring service.

Users provide URLs that your infrastructure will request.

Prevent requests to internal/private destinations such as:

```text
localhost
127.0.0.1
0.0.0.0
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.169.254
```

and other internal/cloud metadata destinations as appropriate.

Re-check redirects as well.

Do not assume validating the initial URL is sufficient.

This should be treated as a **high-priority security requirement before public launch**.

---

# 44. Rate Limiting

Current:

```text
60 requests / minute
```

Review whether one global limit is sufficient.

Eventually separate limits for:

```text
Authentication
Monitor creation
API reads
Statistics
PDF generation
Reports
Billing
```

Expensive operations should have stricter limits.

---

# 45. PDF Reports

Improve reports with:

* Branding
* Account information
* Monitor information
* Uptime
* Response time
* Incidents
* Downtime
* Date range
* Charts
* Generated timestamp

Potential future:

```text
Scheduled reports
```

Example:

```text
Every Monday
→ generate weekly uptime report
→ email customer
```

This could become a paid feature.

---

# 46. Testing Expansion

Current automated tests are a strong foundation.

Expand to:

### Unit tests

* Validation
* Incident transitions
* Statistics
* Entitlements
* Billing logic

### Integration tests

* Authentication
* RLS
* Monitor creation
* Subscription enforcement
* Stripe webhook handling
* Retention

### End-to-end tests

Test:

```text
Signup
 ↓
Create monitor
 ↓
First check
 ↓
Failure
 ↓
Incident
 ↓
Recovery
 ↓
Statistics
```

Also test:

```text
Free user
 ↓
Monitor quota reached
 ↓
Upgrade
 ↓
Higher quota
```

---

# 47. Load Testing

Before serious launch, simulate:

```text
100 monitors
1,000 monitors
5,000 monitors
10,000 monitors
25,000 monitors
```

Measure:

* Check completion time
* Worker CPU
* Database writes
* Database latency
* Cron execution
* Failed checks
* Queue/scheduler backlog
* API latency

Do not guess the scaling limit.

Measure it.

---

# 48. Observability

Introduce structured logging.

Every important operation should contain:

```text
request_id
user/account_id
monitor_id
operation
duration
status
error
```

Avoid logging:

* JWTs
* API secrets
* Passwords
* Sensitive headers
* Full authentication credentials

---

# 49. Product Analytics

Add privacy-conscious analytics to understand:

* Landing page visits
* Signup conversion
* Monitor creation
* First successful check
* Trial conversion
* Upgrade
* Cancellation
* Feature usage

The most important activation metric may be:

> Percentage of new users who create their first successful monitor.

---

# 50. Conversion Funnel

Measure:

```text
Visitor
  ↓
Signup
  ↓
First monitor
  ↓
First successful check
  ↓
Return visit
  ↓
Trial
  ↓
Paid subscription
```

Optimize the biggest drop-off.

---

# 51. Legal / Business Pages

Before accepting real customers, prepare:

```text
Privacy Policy
Terms of Service
Cookie Policy
Refund Policy
Acceptable Use Policy
Security Information
```

These should reflect the actual service and jurisdiction rather than being generic copied templates.

---

# 52. Production Infrastructure

Before launch verify:

* Production domain
* HTTPS
* DNS
* Cloudflare configuration
* Environment variables
* Supabase production project
* Production Stripe environment
* Webhook endpoint
* Cron jobs
* Email provider
* Error monitoring
* Backup strategy
* Database recovery procedure

---

# 53. Email System

Implement transactional email for:

* Welcome
* Email verification
* Password reset
* Monitor down
* Monitor recovered
* Incident notification
* Billing failure
* Subscription confirmation
* Subscription cancellation
* Weekly/monthly reports

Create branded templates.

---

# 54. Pricing Strategy

Start simple.

Example conceptual structure:

```text
Free
    ↓
Starter
    ↓
Pro
    ↓
Business
```

Do not create 8–10 plans.

Make the differences easy to understand.

The pricing page should answer:

> "Why should I pay for the next plan?"

---

# 55. Pricing Should Reflect Infrastructure Cost

Your primary cost drivers will likely include:

```text
Number of monitors
×
Check frequency
×
Retention
×
Notifications
×
Reports
×
Database/storage
```

Therefore avoid unlimited:

```text
1-minute monitoring
```

on cheap plans.

Your billing model should protect your infrastructure margin.

---

# 56. Launch Checklist

## Product

* [ ] Monitoring works reliably
* [ ] Incident state machine tested
* [ ] Recovery tested
* [ ] Retention tested
* [ ] Statistics tested
* [ ] PDF reports tested
* [ ] Rate limits tested
* [ ] RLS tested

## Billing

* [ ] Plans created
* [ ] Stripe Checkout
* [ ] Stripe webhook
* [ ] Subscription state synchronization
* [ ] Upgrade
* [ ] Downgrade
* [ ] Cancellation
* [ ] Payment failure
* [ ] Billing portal
* [ ] Entitlement enforcement

## Frontend

* [ ] Landing page
* [ ] Dashboard
* [ ] Monitor details
* [ ] Incident page
* [ ] Statistics
* [ ] Reports
* [ ] Settings
* [ ] Billing
* [ ] Notifications
* [ ] Onboarding
* [ ] Empty states
* [ ] Error states
* [ ] Mobile responsiveness

## Content

* [ ] Features
* [ ] Pricing
* [ ] FAQ
* [ ] Documentation
* [ ] Blog
* [ ] Use cases
* [ ] About
* [ ] Contact
* [ ] Security
* [ ] Privacy
* [ ] Terms

## SEO

* [ ] Metadata
* [ ] Canonicals
* [ ] Sitemap
* [ ] Robots.txt
* [ ] Open Graph
* [ ] Structured data
* [ ] Internal linking
* [ ] SEO landing pages
* [ ] Documentation
* [ ] Blog strategy

## Security

* [ ] SSRF protection (partial: literals and redirects checked; DNS pinning remains)
* [ ] RLS audit
* [ ] JWT audit
* [ ] Rate limiting (per-isolate limits exist; distributed enforcement and validation remain)
* [ ] Stripe webhook verification
* [ ] Secret management
* [ ] CORS
* [ ] CSP (implemented in source; browser verification after deployment remains)
* [ ] Security headers (implemented in source; post-deployment verification remains)
* [ ] Sensitive log audit
* [x] Dependency audit (npm audit reports zero known vulnerabilities as of 2026-10-09)

## Scalability

* [x] Statistics queries optimized (recent raw checks are aggregated in PostgreSQL)
* [x] Pagination implemented for check and incident history (monitor list is quota-bounded)
* [ ] Database monitoring
* [ ] Load testing
* [ ] Scheduler tested under load
* [ ] Retention performance tested
* [ ] Database backup/recovery tested

---

# 57. Recommended Development Order

Do not implement everything simultaneously.

Use this order:

```text
PHASE 1
Core backend hardening
        ↓
PHASE 2
Statistics/database optimization
        ↓
PHASE 3
Subscription + Stripe
        ↓
PHASE 4
Frontend dashboard
        ↓
PHASE 5
Public marketing website
        ↓
PHASE 6
Documentation + SEO content
        ↓
PHASE 7
Security audit
        ↓
PHASE 8
Load testing
        ↓
PHASE 9
Production deployment
        ↓
PHASE 10
Growth + advanced features
```

---

# 58. Highest-Priority Tasks

If development time is limited, prioritize these:

### 🔴 Critical

1. Optimize statistics queries
2. Implement subscription/entitlement architecture
3. Integrate Stripe
4. Implement SSRF protection
5. Improve dashboard
6. Build professional landing page
7. Create pricing page
8. Create documentation
9. Add legal pages
10. Perform security audit

### 🟠 High Priority

11. Onboarding
12. Incident UI
13. Statistics charts
14. Notification system
15. Billing dashboard
16. Responsive UI
17. SEO foundation
18. Blog
19. Use-case pages
20. Load testing

### 🟡 Later

21. Team/workspace support
22. Public status pages
23. Slack/Discord integrations
24. Queue-based monitoring
25. Hourly aggregation
26. Database partitioning
27. Scheduled reports
28. Advanced API validation
29. More integrations
30. Enterprise features

---

# 59. Definition of "Launch Ready"

API Monitor should be considered ready for public paid launch when a new customer can complete this entire journey without developer intervention:

```text
Visit website
      ↓
Understand product
      ↓
View pricing
      ↓
Create account
      ↓
Create first monitor
      ↓
Receive successful check
      ↓
See dashboard
      ↓
Experience simulated/real failure
      ↓
Receive notification
      ↓
View incident
      ↓
View recovery
      ↓
View statistics
      ↓
Upgrade subscription
      ↓
Manage billing
      ↓
Download report
```

If that entire flow is reliable, the product has moved beyond a capstone/MVP and is becoming a genuine SaaS product.

---

# 60. Long-Term Product Direction

The long-term product should evolve from:

> "A tool that checks whether an API is alive."

into:

> **"A complete API reliability and health monitoring platform for developers, SaaS teams, and API providers."**

Potential future capabilities:

* API monitoring
* Synthetic monitoring
* API assertions
* Response validation
* Performance monitoring
* Incident management
* Alerting
* Public status pages
* Team collaboration
* API reliability reports
* SLA monitoring
* Webhooks
* Slack/Discord integrations
* Scheduled reports
* API analytics
* Historical reliability analysis
* Enterprise workspaces

The existing monitoring engine provides a strong foundation for this direction. The next major milestone is not simply adding more backend functionality; it is turning the engine into a **complete, understandable, trustworthy, and discoverable SaaS product**.
