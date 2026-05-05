# 0001 — Shared Supabase database between amasi-membership and AMASI-management

## Status

Accepted (this ADR captures an existing production reality, not a new decision).

## Context

AMASI runs two production Next.js applications:

- `amasi-membership` — the public member-facing portal at membership.amasi.org. Member applications, payments, digital membership cards, support tickets, partner APIs.
- `AMASI-management` — the staff-facing operations app at collegeofmas.org.in. Faculty management, session scheduling, badges, delegate tracking, on-site check-in, examinations.

Both applications need access to the same underlying data — primarily the members table, but also payments, events, and several shared tables. Members of AMASI are also delegates and faculty at AMASI events; payments flow through both apps; auth users span both worlds.

## Decision

Both applications connect to the same single Supabase project. There is no second database, no data synchronisation layer, no API gateway between them. Each app uses the Supabase client directly (with appropriate keys) to read and write the same tables.

## Consequences

### Positive

- **Single source of truth.** Member data, faculty data, and event data exist in exactly one place. There is no possibility of two apps disagreeing about who someone is or what they paid.
- **No synchronisation problems.** No data sync jobs to write, debug, or fail silently.
- **Simpler operational footprint.** One database to back up, monitor, secure, and scale.
- **Consistent authentication.** A user logging in is the same identity in both apps because both apps trust the same Supabase auth users.
- **Lower cost.** One Supabase project, not two.

### Negative

- **Schema changes are cross-cutting.** A migration that renames or drops a column in a shared table can break either app if the other isn't updated in the same release window.
- **A bug in one app's writes can affect the other app's reads.** If `AMASI-management` writes bad data to a shared column, `amasi-membership` will see it.
- **Row-Level Security (RLS) policies must serve both apps' access patterns.** Tightening a policy for one app may unintentionally break the other.
- **Future systems inherit the same constraint.** When the planned AMASI Members mobile app is built, it will read from the same shared Supabase, which means schema discipline becomes more important as more clients depend on the same tables.

### Mitigations

- **Schema migrations live in a single repository.** Currently in `AMASI-management/supabase/migrations/`. That folder is the source of truth; ad-hoc SQL changes in the Supabase dashboard should be exceptional and immediately followed by a migration file.
- **Both apps share the same JWT secret** so authentication is consistent.
- **RLS is enabled on all tables containing member or faculty data.** Both apps are written to assume RLS is in force.
- **Documentation discipline.** This ADR, the Systems Map, and the per-repo READMEs together capture the shared-database reality so that future maintainers don't need to discover it the hard way.

## Alternatives considered

- **Separate Supabase projects per application.** Rejected because it would require building data synchronisation between them, which is more operationally complex than coordinating schema changes. It would also fragment authentication, which would create a worse experience for users who exist in both worlds.
- **A shared API gateway layer in front of Supabase.** Deferred. This adds a new piece of infrastructure to maintain (and a new failure point) for benefit that doesn't currently outweigh the cost. Could be revisited if the number of client applications grows significantly — for example, if the mobile app, the membership portal, and AMASI-management all want different views of the same data with different authorisation rules, a gateway might become worth it.
- **A monolithic single application.** The two apps serve fundamentally different audiences (public members vs. internal staff) and have very different deployment and access-control requirements. Merging them would significantly increase complexity for no real gain.

## Notes

This ADR captures an existing architectural reality, not a new decision. It exists so that:

- Future maintainers understand why the apps share a database rather than each owning their own.
- Future architectural decisions touching this area can reference this ADR explicitly rather than re-litigating the question.
- A future ADR (e.g. "0002 — Mobile app authentication strategy") can link back to this one for context.

Anyone proposing to break the shared-database arrangement (for example, by giving the mobile app its own database) should write a successor ADR explaining the reasoning.
