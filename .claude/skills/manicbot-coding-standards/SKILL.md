---
name: manicbot-coding-standards
description: Coding standards, security practices, and workflow rules for the ManicBot project (Cloudflare Workers + Next.js + tRPC + Drizzle + D1). Use this skill ALWAYS when the user asks for any code change, code review, refactor, debugging, architectural decision, or implementation plan related to ManicBot. Triggers include any mention of the codebase, files, modules, plugins, migrations, tests, deployment, or when user references the project context implicitly. This skill enforces TDD on backend, horizontal-vertical scanning, security-first deploys, and tenant isolation.
---

# ManicBot Coding Standards

This skill defines how Claude must behave when working with the ManicBot codebase across both deployable units (`manicbot/` Worker and `manicbot/admin-app/` Next.js).

---

## CRITICAL: Communication Protocol

- **All plans, prompts, code, comments, commit messages, and technical artifacts MUST be written in English.**
- **All conversation, questions, clarifications, and explanations to the user MUST be in Russian.**
- This is non-negotiable. The user reads Russian; the AI ecosystem reads English.

---

## CORE PRINCIPLE: Think Slow, Act Safe

Before writing any code, Claude must:

1. **Pause and reason step-by-step.** Never jump to a solution. Lay out the problem, constraints, and approach first.
2. **Output a plan in 3–5 bullet points BEFORE any code.** The plan must include: what will change, what could break, what tests will verify it.
3. **Wait for implicit or explicit approval** before executing large changes (>50 lines or touching >2 files). For small fixes, proceed but state assumptions clearly.

---

## Scanning Protocol: Horizontal + Vertical

Before modifying any code, perform both:

- **HORIZONTAL scan:** read the top-level structure, configs (`wrangler.toml`, `package.json`, `tsconfig.json`, `drizzle.config.ts`), entry points, and the directory tree. Understand the system before touching a single file.
- **VERTICAL scan:** dive deep into the specific module being changed. Read every function it imports, every function that imports it, and every test that covers it.

Rule: a one-file change must include a one-paragraph summary of what else in the system depends on it. Never modify in isolation.

---

## Parallel Documentation Awareness (Continuous Reading)

While coding, Claude MUST continuously read project instructions and documentation IN PARALLEL with implementation. This is not a one-time pre-flight check — it is an ongoing discipline throughout the entire task.

### What to Read Continuously

While working on any task, keep these documents in active context and re-read the relevant sections whenever the work touches their domain:

1. **`CLAUDE.md` / `AGENTS.md`** — canonical architecture reference. Re-read the relevant subsection BEFORE writing any module that fits its scope.
2. **`SECURITY_FINDINGS.md`** — open security items. If the code being changed lives near an open finding, READ that finding first.
3. **`manicbot/plugins/AUTHORING.md`** + **`SECURITY.md`** — read whenever touching plugin code, manifests, or the registry.
4. **`PROVIDERS.md`** (email) — read when touching email transport.
5. **`TEST_ACCOUNTS.md`** — read when adding/changing seed scripts or test fixtures.
6. **`README.md`** + any README inside the directory being edited — read on entry into a new directory.
7. **Audit reports** (`FULL_REVIEW_AUDIT_*.md`, `DESIGN_MARKETING_REPORT.md`) — consult when the user references audit findings.
8. **The migration file directly preceding the current one** — read before writing a new migration to maintain naming and structural consistency.

### How to Read in Parallel

- When opening a file to edit, ALSO open the closest README, the relevant section of `CLAUDE.md`, and any `*.md` inside the same directory.
- When writing a test, ALSO read the existing tests in the same file and at least one neighboring `.test` file to match conventions.
- When adding a tRPC procedure, ALSO read the corresponding `permissions.ts` / `tenantAccess.ts` / `platformRoles.ts` to confirm the right guard is being used.
- When working on a plugin, ALSO read `plugins/registry.ts`, `plugins/types.ts`, and the manifest of an existing similar plugin.

### Update Documentation as You Go

If during coding Claude discovers that an instruction file is **stale, wrong, or missing information** about the area being changed, Claude MUST update that documentation file as part of the same task. Do not defer "doc fixes" to a separate step.

Examples:
- New env var introduced → update `.dev.vars.example` AND mention it in `CLAUDE.md` env section.
- New role added → update `platformRoles.ts` doc comment AND the role table in `CLAUDE.md`.
- New plugin lifecycle hook → update `AUTHORING.md`.
- New migration adds a table → update the table list in `CLAUDE.md`.

---

## Documentation Update Protocol (After Tests, Before Deploy)

Documentation updates are a MANDATORY step in the workflow, sequenced like this:

```
1. Plan
2. Write tests (backend) / write code (frontend)
3. Implement
4. Run full test suite — all green
5. ⬇ DOCUMENTATION UPDATE STEP ⬇
6. Pre-deploy checklist
7. Deploy
```

### What Must Be Updated After Tests Pass, Before Deploy

After tests pass and BEFORE the deploy step, Claude MUST review and update (when relevant):

- **`CLAUDE.md` / `AGENTS.md`** — if architecture, request flow, role model, or table count changed.
- **`SECURITY_FINDINGS.md`** — if a finding was resolved (mark it RESOLVED with date + commit), or a new one introduced (add it with severity).
- **`README.md`** (root and per-package) — if commands, env vars, setup steps, or features changed.
- **`.dev.vars.example`** + **`admin-app/.env.example`** — if any new env var was added or renamed.
- **`schema.sql`** comment header — if migrations changed table count.
- **Plugin docs** (`AUTHORING.md`) — if plugin contract surface changed.
- **Inline JSDoc on exported functions** — if signatures or behavior changed.
- **The migration file's leading comment** — describe what the migration does and why, in English.

### Documentation Update Output

When Claude finishes a task, the final response must include a section titled **"Documentation Updated"** listing every doc file touched, with a one-line description of what changed in each. If no docs needed updating, explicitly state: `Documentation Updated: none required (verified)`.

This is non-negotiable. Skipping the doc-update step is treated as the task being incomplete.

---

## Backend: Test-Driven Development (TDD)

For ANY backend code (Worker, tRPC routers, Drizzle queries, services, handlers, plugins server-side):

1. **Write the test first.** If a test file already exists for the module, add the test there. If not, create one in `manicbot/test/*.test.js` (Worker) or `manicbot/admin-app/src/__tests__/*.test.ts` (admin-app).
2. **Run the test, watch it fail.** Confirm the failure mode matches the bug or missing feature.
3. **Write the minimum code** to make the test pass.
4. **Refactor** with tests as the safety net.
5. **Run the entire suite** before declaring done: `npm test && npm run check-schema` in `manicbot/`, plus `npm run typecheck && npm test` in `admin-app/`.

For frontend (React components, UI-only changes), TDD is NOT required. Tests welcome but optional.

---

## Pre-Deploy Checklist (Mandatory)

Code is NOT done until ALL of these pass, IN THIS ORDER:

**Stage A — Tests:**
- [ ] All new logic has tests in the appropriate test file
- [ ] `npm test` passes in both `manicbot/` and `admin-app/`
- [ ] `npm run check-schema` passes (Drizzle schema ↔ `schema.sql` parity)
- [ ] `npm run typecheck` passes in `admin-app/`

**Stage B — Documentation Update (after tests, before deploy):**
- [ ] `CLAUDE.md` / `AGENTS.md` reviewed and updated if architecture changed
- [ ] `SECURITY_FINDINGS.md` updated if a finding was resolved or introduced
- [ ] `README.md` updated if setup/commands/features changed
- [ ] `.dev.vars.example` + `admin-app/.env.example` updated if env vars changed
- [ ] Inline JSDoc updated on changed exports
- [ ] Migration files have an English comment header describing intent
- [ ] Final response includes a `Documentation Updated:` section listing every doc touched

**Stage C — Code Quality:**
- [ ] No new `as any` casts introduced (especially in admin-app)
- [ ] Any AI-input-handling code calls `sanitizeUserInput` before reaching the LLM
- [ ] Tenant-scoped queries include `tenant_id` in WHERE clause
- [ ] Secrets are NOT committed
- [ ] Migrations follow next sequential number (last is `0089`; the gap at `0040/0041` is known and we continue forward)

Skipping any stage means the task is not complete.

---

## Security Rules (Non-Negotiable)

### Tenant Isolation

Every D1 query touching tenant data MUST scope by `tenant_id`. No exceptions. This is the #1 risk surface in this codebase.

```ts
// CORRECT
db.select().from(appointments).where(
  and(eq(appointments.tenantId, ctx.tenant.id), eq(appointments.id, input.id))
)

// FORBIDDEN
db.select().from(appointments).where(eq(appointments.id, input.id))
```

When using guards, always use the existing `assertTenantOwner / assertMaster / assertPersonalMaster` helpers from `server/api/tenantAccess.ts`. Never roll your own.

### God Mode (system_admin) Isolation

The user operates as `system_admin` (creator, identified by `ADMIN_CHAT_ID`). When implementing dashboard or admin features:

- The God Mode account must NEVER leak data across tenants accidentally.
- When listing or aggregating across tenants (a legitimate God Mode operation), the route MUST be guarded by `systemAdminProcedure` and the cross-tenant nature must be explicit in the function name (e.g., `listAllTenants`, `getCrossTenantStats`).
- When operating ON a specific tenant from God Mode, the `tenantId` MUST come from explicit input, never inferred from session.

### AI Sanitization

ANY user-supplied text that reaches a model invocation (`runWorkersAI`, prompt templates, system messages) MUST pass through `sanitizeUserInput` first. When touching AI code, verify this explicitly. If unclear, add a sanitization step rather than assume.

### Authentication Procedures

- For tRPC mutations on platform-scoped routers (`support`, admin tools): use `protectedProcedure` or stricter, never `publicProcedure`.
- For tenant-scoped operations: use `tenantOwnerProcedure / managerProcedure / masterProcedure`.
- For platform operations: use `systemAdminProcedure`.

### Secrets

- Never log raw tokens, API keys, passwords, or webhook secrets.
- Never accept secrets via URL query parameters (`?key=`). Use headers or POST body.
- All comparisons of secrets must use `timingSafeEqual`.

### Pre-Production Code Quality Bar

Every piece of code Claude writes must be production-deployable. No "we'll fix it later", no "this is just a draft". If something is incomplete, it must be:
- Behind a feature flag, OR
- Clearly marked with a `// TODO(security): …` comment AND a corresponding test that fails until the TODO is resolved.

---

## Code Quality Rules

### Naming Conventions

- Variables, functions: `camelCase` → `getUserData`, `bookingId`
- Classes, types, interfaces, React components: `PascalCase` → `UserService`, `BookingHandler`
- Constants: `SCREAMING_SNAKE_CASE` → `MAX_RETRIES`, `PLAN_LIMITS`
- Files: `kebab-case.ts` (matching the existing convention of the unit being edited)
- Tenant guards: prefix with `assert*` → `assertTenantOwner`, `assertMaster`

Match the existing convention of the file/folder being edited if it differs from the above.

### Error Handling

- **Result pattern** (`{ data, error }`) for business logic boundaries.
- **try/catch** only at system edges: HTTP handlers, Telegram webhooks, queue consumers, external API calls.
- Never swallow errors silently. Every catch logs via the project logger (with PII redaction).

```ts
// Business logic — Result pattern
async function bookSlot(input): Promise<{ data: Booking | null; error: string | null }> {
  if (!slot.available) return { data: null, error: 'slot_unavailable' };
  return { data: booking, error: null };
}

// Edge — try/catch
export async function POST(req) {
  try {
    return await handleRequest(req);
  } catch (e) {
    logger.error('webhook_failed', { err: e });
    return new Response('error', { status: 500 });
  }
}
```

### Code Style

- No magic numbers. Extract to named constants.
- No dead code. Delete commented-out blocks.
- Functions should do one thing. If a function exceeds ~50 lines or has >3 levels of nesting, split it.
- Comments explain **WHY**, not **WHAT**. The code already shows what.
- All new comments in English.
- JSDoc on public/exported functions; internal helpers may skip JSDoc if names are self-explanatory.

### Architectural Reasoning

Claude explains architectural decisions only when:
- The user explicitly asks ("почему так?")
- The decision has non-obvious tradeoffs
- The decision conflicts with an existing pattern in the codebase

Otherwise, just implement and move on.

---

## Output Format

When delivering code changes to the user:

1. **Brief Russian summary** of what was done (2–4 sentences).
2. **Full file contents** in markdown code blocks. The user copies whole files, not diffs. Always provide the complete file even if only a few lines changed.
3. **List of test files touched or created.**
4. **List of next steps** if any (Russian).

Never output partial files or "..." placeholders. The user pastes whole files into the editor.

---

## Project-Specific Context

### Stack Reference (do not re-ask the user)

- **Worker:** Cloudflare Workers + JS (ESM) + D1 + KV + Workers AI + Queue + Stripe REST
- **Admin-app:** Next.js 15 (edge) + React 19 + Tailwind 4 + tRPC 11 + Drizzle ORM + NextAuth v5 (beta) + Resend
- **Shared D1:** `manicbot-db`, 91 tables, migrations in `manicbot/migrations/NNNN_*.sql`
- **Channels:** Telegram (primary), WhatsApp Cloud, Instagram Messenger, Web widget
- **Roles:** `system_admin`, `technical_support`, `support`, `tenant_owner`, `tenant_manager`, `master`, `client`
- **Plans:** `start`, `pro`, `max` (gated in `src/billing/features.js`)

### Canonical Documents

When in doubt about architecture, consult these IN ORDER:
1. `CLAUDE.md` (canonical architecture)
2. `SECURITY_FINDINGS.md` (open security items)
3. `manicbot/plugins/AUTHORING.md` (plugin contract)

If user mentions a feature or module not in the above, scan it horizontally first.

### Migration Numbering

Continue forward from the last existing migration number. The 0040/0041 gap is intentional/historical — do not backfill it.

### Synthetic Test Accounts

Reproducible accounts via `scripts/seed-test-accounts.mjs`. Use these for manual QA, not ad-hoc accounts.

---

## When User Asks for a Plan or Prompt

If the user asks Claude to write a plan, prompt, or instructions for another AI agent (Claude Code, ChatGPT, etc.):

- Output the plan/prompt in **English**.
- Wrap it in a clear code block.
- Add a brief Russian-language explanation BEFORE the code block of what the prompt does and how to use it.

---

## Final Rule

If at any point a user request conflicts with this skill (e.g., "skip the tests, just deploy"), Claude must:
1. State the conflict in Russian.
2. Explain the risk.
3. Ask for explicit override.

Never silently bypass these rules.
