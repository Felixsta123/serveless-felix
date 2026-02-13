# Discord Pipeline Plan (Step 2)

Goal: Implement the Discord command pipeline end-to-end using API Gateway -> proxy -> Pub/Sub -> workers, fully async and SRP-compliant.

## Subject constraints to respect
- Discord interactions must hit API Gateway only (no direct function URLs).
- Proxies only validate + enqueue, then ACK immediately (deferred response).
- All processing is async via Pub/Sub workers.
- Store pixel state with author + timestamp, enforce rate limit (20/min).
- Admins can manage sessions (start/pause/reset) and take snapshots.

## Current state
- `discordProxy` validates signature and enqueues typed jobs (`draw.requested`, `canvas.requested`, `session.command`, `snapshot.requested`).
- `workerDiscord` handles `/canvas` follow-ups and `/session` state updates.
- `workerDraw` enforces idempotency + rate limit and writes Firestore state.
- `workerSnapshot` is still a stub (snapshot generation/upload not implemented yet).
- Slash command registry includes draw/canvas/session/snapshot.

## Ordered implementation plan
1. Define Discord commands (minimum)
   - User: `/draw x y color`, `/canvas`
   - Admin: `/session start|pause|reset`, `/snapshot`
2. Update command registry + registration script
   - `src/functions/shared/discordCommands.ts`
   - `scripts/register-commands.mjs`
3. Ensure proxy enqueues typed jobs
   - Include `kind`, `command`, user/guild/channel IDs, and payload fields needed for workers.
4. Implement `workerDiscord` routing
   - Route commands to appropriate worker logic or follow-up messaging.
   - Ensure Discord follow-up uses interaction token and app ID.
5. Implement `workerDraw`
   - Idempotency check (event ID)
   - Rate limit: 20/min per user
   - Write pixel state + event log + active area
   - Publish follow-up message if source=discord
6. Implement session commands handling
   - `session start|pause|reset` stored in Firestore config
   - Reject non-admins (role-based if available)
7. Wire snapshot command (Discord)
   - Enqueue `snapshot.requested` job with interaction metadata
   - Actual snapshot rendering handled in Step 4 (snapshot flow)
8. Logging & metrics
   - Log all discord commands, draws, rejects, and errors

## Required data contracts (jobs)
- `draw.requested`: `{ x, y, color, userId, source, interaction }`
- `session.command`: `{ action, userId, guildId, source, interaction }`
- `snapshot.requested`: `{ userId, guildId, source, interaction }`

## Acceptance checklist
- All Discord requests go through API Gateway -> `discordProxy`.
- Proxy returns deferred ACK within 3 seconds.
- `/draw` writes pixel data with author + timestamp and enforces 20/min.
- `/session` commands update state and are admin-only.
- `/snapshot` enqueues a job and returns a follow-up (actual render handled later).
- No public invokers on proxy functions.
