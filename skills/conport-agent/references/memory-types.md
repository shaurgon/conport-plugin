# Memory Types & PARA Categories

## Memory Types

| Type | When to use | Example |
|------|-------------|---------|
| `fact` | Durable knowledge about the environment | "Deploy uses helm upgrade --install" |
| `feedback` | User/orchestrator corrected your behavior | "Do not add emoji to commit messages" |
| `pattern` | Reusable approach or recurring issue | "FK violations return 500 — validate existence before INSERT" |
| `note` | Daily timeline entry, event, session log | "Deployed CryptoFlow to Coolify, health check passed" |
| `tacit` | User behavior patterns and preferences | "User prefers terse answers without trailing summaries" |
| `decision` | Architectural/design choice with rationale | "Chose Supabase over Firebase for auth — native pgvector support" |

## PARA Categories

| Category | When to use | Example |
|----------|-------------|---------|
| `project` | Active work with a goal or deadline | Facts about CryptoFlow deployment |
| `area` | Ongoing responsibility, no end date | Infrastructure knowledge, team conventions |
| `resource` | Reference material (default) | API contracts, tool documentation |
| `archive` | Inactive — moved here when no longer relevant | Old project facts after completion |

## What to save and how

| What happened | memory_type | category |
|---------------|-------------|----------|
| Discovered environment quirk | `fact` | `resource` or `area` |
| User corrected behavior | `feedback` | `area` |
| Found reusable approach | `pattern` | `resource` |
| End of session / daily events | `note` | `project` |
| Learned user preference | `tacit` | `area` |
| API contract not documented elsewhere | `fact` | `resource` |
| Made architectural choice | `decision` | `area` |
