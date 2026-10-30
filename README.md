# ARROVEN

ARROVEN is an investigation workspace for aircraft technical faults that keep coming back or can't be reproduced. Engineers stay in control throughout. The app reads only authorised copies of the records, drafts a dated chronology in which every statement cites one line of an original record, and lets engineers test the explanations they write against that evidence. A reviewer then approves a versioned handover.

ARROVEN supports investigation reasoning. It does not declare a root cause, direct maintenance or make an airworthiness decision.

## Run it locally

Requires Node 20.9 or later. No database server is needed for development: an embedded Postgres (PGlite) is created in `./.data/pglite` the first time the app runs.

```bash
npm install
npm run seed        # optional: a demo organization, two local accounts and the fictional demo case
npm run dev         # http://localhost:3000
```

`npm run seed` prints the two local accounts it creates; their passwords are in `scripts/seed-dev.ts`. Sign in as the engineer to draft and check, and as the reviewer to approve. Stop `npm run dev` before re-seeding, because the embedded database supports only one process at a time. To start over, delete `.data/` and `storage/`.

You can also skip seeding: sign up, then choose **Load demo case** on the cases page.

### Models

Drafting, evidence suggestions and compare-and-propose run on ARROVEN's own models, served by ARROVEN's model service.
Set `MODEL_SERVICE_URL` (and `MODEL_SERVICE_TOKEN`) to use it; the request and response contract is in
[docs/model-service-contract.md](docs/model-service-contract.md). No third-party AI service is used, so partner data never
leaves ARROVEN's hosting. Without a URL the app uses an offline mock, and the header shows **Mock AI**.

Engineer decisions become training data: Settings, Training data exports a de-identified JSON Lines dataset from cases
with a recorded training permission. Format: [docs/training-export-format.md](docs/training-export-format.md).

## Checks

```bash
npm run typecheck
npm test            # unit tests plus an end-to-end workflow against an in-memory Postgres
npm run build
```

## How it works

| Area | Where | Notes |
|---|---|---|
| Web app | `src/app` | Next.js App Router. Pages are server-rendered; mutations are server actions in `src/app/actions.ts`. |
| Domain services | `src/server/services` | All business rules live here and take a `Ctx` (database, user, organization, role). Every query is scoped by organization. |
| Permissions | `src/server/permissions.ts` | Roles: owner, admin, reviewing engineer, engineer, viewer. |
| Database | `src/server/db/schema.ts`, `drizzle/` | Drizzle ORM on Postgres. PGlite in development and tests, any Postgres 15+ in production. |
| Source import | `src/server/sources` | Text, CSV and PDF (text layer). Each line, row or PDF line becomes a citable locator (`S1:12`, `S2:R7`, `S3:p2.14`). Originals are stored content-addressed, read-only, and hash-checked on every read. |
| Models | `src/server/ai` | The model-service contract and connector, the offline mock, and output validation. Runs are queued, executed after the response, and polled by the page. |
| Training data | `src/server/training` | Training permissions per case and de-identified, hashed, logged exports for ARROVEN's own models. |
| Handover | `src/lib/handover.ts` | Renders only engineer-checked statements and engineer decisions. An approved version is immutable and stored with its SHA-256. |

### The nine-stage workflow (Team Explainer, 22 Oct 2026)

| Stage | Where in the app |
|---|---|
| 1 Frame the question | Open a case; edit the question, cutoff and responsible engineer on **Overview** |
| 2 Add authorised records | **Sources**: import read-only, record authorisation (with its basis), record missing sources, see what intake extracted |
| 3 Prepare the case | **Chronology**: AI draft from authorised, current records only; any record left out is shown |
| 4 Find relevant evidence | **Explanations**: AI evidence suggestions per explanation |
| 5 Compare findings | **Compare & propose**: AI comparisons citing at least two checked statements |
| 6 Proposals and questions | **Compare & propose**: adopt, reject or leave unresolved, with a reason |
| 7 Engineer review | Check each statement; record evidence decisions; assess each explanation (consistent, not consistent, unresolved) |
| 8 Preserve and share | **Questions & review**: approve an immutable version with a sharing scope |
| 9 Reassess changes | A corrected copy, withdrawn authorisation, changed decisions, or a changed question or cutoff flags dependent work; approval is blocked until it is re-checked |

### Safeguards built into the workflow

- **Every AI statement must cite a real line.** Output that cites a locator that doesn't exist is dropped and counted. The case overview shows that count next to the accepted, corrected and rejected rates, so AI error is measured, not assumed.
- **Record text is treated as data.** Prompts put records inside tags and tell the model not to follow instructions found in them.
- **Planned work is never shown as performed.** The prompt requires this, and the engineer checks it.
- **Only checked evidence counts.** A statement can't be used in an evidence decision until an engineer has accepted or corrected it, and every decision needs a written reason. AI suggestions are stored separately from engineer decisions.
- **A redraft never overwrites reviewed work.** It replaces only unreviewed AI statements and undecided AI flags.
- **Approvals are versioned and can be independent.** An organization can require that the approver isn't the engineer who opened the case. After an approval, any change marks the case "changed since vN", and approving again creates vN+1; earlier versions never change.
- **Unconfirmed permission does not permit use.** Records are imported as unconfirmed unless a reviewing engineer or admin records an authorisation basis. The AI reads only confirmed, current records, and every run records which sources it left out.
- **Change is not acceptance.** A corrected copy supersedes the earlier one (both stay visible); statements citing the old copy and explanations relying on them are flagged, and only an engineer's re-check or reassessment clears the flag.
- **There is a full audit trail.** Every import, review, decision, AI run and approval is recorded with who did it and when.

## Production

`docker compose up --build` runs Postgres and the app together. For a real deployment:

1. Provide `DATABASE_URL` and run `npm run db:migrate` (the Docker image does this on start).
2. Mount durable storage at `STORAGE_DIR`, or replace `src/server/sources/storage.ts` with object storage that has write-once retention.
3. Set `APP_URL` so invite links point to the right host, and set `MODEL_SERVICE_URL` and `MODEL_SERVICE_TOKEN` for ARROVEN's model service.
4. Run the app on a long-running Node server. AI runs execute in the same process after the request returns; for horizontal scaling, move `executeRun` to a job queue.

## Not built yet

- SSO (SAML/OIDC), and email delivery for invites (an invite currently creates a link to send yourself)
- Billing (plan limits are enforced, but changing plan is applied directly)
- OCR for scanned PDFs
- Integrations that read directly from MRO or maintenance information systems
- Per-tenant data residency and retention controls
- Review timing captured in the interface (today the median time from draft to decision is the proxy)

Before importing any non-public records, the operator and other rights holders must approve the purpose, permitted fields, processing location, named users, retention and AI-provider terms in writing.
