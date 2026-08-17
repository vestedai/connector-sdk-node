# Relational schema intelligence

> **This SDK cannot declare a relational source yet.** The capability is
> platform-side and live, but only the [.NET](../../dotnet/docs/schema.md) and
> [PHP](../../php/docs/schema.md) SDKs can declare one today. This page explains
> what it is and what declaring would take, so you can tell whether you need it.

An agent that can run SQL against your database has a problem before it writes a
single query: it does not know what the tables are called.

Left to itself it solves that with SQL — a query against `INFORMATION_SCHEMA` to
find the table, another for the columns, then the real query. Every conversation
pays for it again, and a wrong guess costs a round trip and an error.

Schema intelligence replaces that. A connector declares a relational source, the
platform extracts its schema once, indexes it, and gives every agent two tools —
`search_schema` and `describe_entity` — that answer "what is this table called
and what columns does it have" from the index instead of from the database.

The gap is not small. On one production Business Central connector, over the
seven days to 2026-08-17, the SQL tool took **13,251 calls** while the schema
tools took **55** — and the platform was already holding a complete, embedded
snapshot of that database the whole time.

---

## What you can use today

The two agent tools are injected by the platform, not by your connector, so they
already reach agents regardless of which SDK a connector is built on:

- **`search_schema`** — takes a question, returns the matching entities with
  their physical table names, join keys and ranked columns.
- **`describe_entity`** — returns one entity's full column list.

What a Node connector cannot do is *supply* the schema they read. Until this SDK
can declare a `relational_source`, a Node connector's own database is invisible
to extraction, and its SQL tool — if it has one — is never governed by the query
gate.

If your connector fronts a relational database and you want the index, the
options are to build that connector on the .NET or PHP SDK, or to ask for the
declaration to be added here.

## What declaring involves

Four things, so you can size the work:

1. **A `relational_source` declaration** naming the engine (`sqlserver` or
   `mysql`), the key of a rowset tool that returns your schema, the key of your
   free-form SQL tool, and which argument of that tool carries the SQL text.
2. **A describe tool** returning the canonical model — logical entities, each
   with the set of *physical* tables that make it up, its join key, and its
   columns; plus the relations between them. This is the substantive part: one
   logical entity is often several physical tables (`Item` is 8 for a single
   Business Central company), and nothing in `INFORMATION_SCHEMA` says so.
3. **A cheap catalog fingerprint**, read on every registration. The platform
   re-extracts only when it changes.
4. **Scopes** — the databases or companies the source spans, and which one an
   unqualified table name resolves in.

The [.NET page](../../dotnet/docs/schema.md) documents all four in full,
including the canonical row shape, which is language-independent: it is the
wire contract, and a Node implementation would emit exactly the same JSON.

## Writing SQL-tool instructions

This part applies to you now, with no declaration needed.

If your connector exposes a SQL tool, the instruction text attached to its SQL
*argument* is read at the moment the model writes a query — it outweighs
anything in the system prompt. Point the model at `search_schema` /
`describe_entity` first, and keep engine-native discovery (`INFORMATION_SCHEMA`,
`sys.*`) as a documented fallback.

Getting this backwards is what produced the numbers at the top of this page: the
argument description said *"NEVER write a table name you have not seen returned
by INFORMATION_SCHEMA"* and handed over the discovery query, and the schema tools
went unused for months.
