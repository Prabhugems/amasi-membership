/**
 * Minimal, hand-rolled in-memory Supabase query-builder mock — proposed in
 * the Part B (item 10) plan and confirmed with Prabhu rather than pulling in
 * a real local Postgres/Supabase CLI instance, which nothing in this repo
 * sets up today. Implements only the chain methods MOU code actually calls
 * (from/select/insert/update/eq/neq/in/is/not/gt/gte/lt/lte/contains/order/
 * limit/range/maybeSingle/single), backed by a plain array per table that
 * each test seeds directly via `seed`.
 *
 * Not a general-purpose PostgREST emulator — e.g. `.or()` is a no-op
 * passthrough (no MOU code under test here relies on its actual filtering).
 * Extend only the methods a new test genuinely needs.
 */

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

export interface MockTables {
  [table: string]: Row[]
}

// Splits on top-level commas only — commas inside and(...) groups are kept
// intact so each group parses as one clause.
function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const ch of s) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      parts.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

function evalCondition(cond: string, row: Row): boolean {
  const segments = cond.split(".")
  const col = segments[0]
  const value = segments[segments.length - 1]
  const op = segments.slice(1, -1).join(".")
  const rowVal = row[col] ?? null
  const target = value === "null" ? null : value
  switch (op) {
    case "is":
      return rowVal === target
    case "not.is":
      return rowVal !== target
    case "eq":
      return rowVal === target
    case "lte":
      return rowVal !== null && (rowVal as string) <= (target as string)
    case "gte":
      return rowVal !== null && (rowVal as string) >= (target as string)
    default:
      throw new Error(`mou-supabase-mock: unsupported .or() operator "${op}" in condition "${cond}"`)
  }
}

function evalOrExpr(expr: string, row: Row): boolean {
  return splitTopLevel(expr).some((clause) => {
    const andMatch = clause.match(/^and\((.*)\)$/)
    if (andMatch) return splitTopLevel(andMatch[1]).every((c) => evalCondition(c, row))
    return evalCondition(clause, row)
  })
}

export function createMockSupabase(seed: MockTables = {}) {
  const tables = new Map<string, Row[]>(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))

  function getTable(name: string): Row[] {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }

  function from(tableName: string) {
    const filters: Filter[] = []
    let orderCol: string | null = null
    let orderAsc = true
    let limitN: number | null = null
    let rangeFrom: number | null = null
    let rangeTo: number | null = null
    let countExact = false
    let mode: "select" | "insert" | "update" | "delete" = "select"
    let payload: Row | Row[] | null = null

    function matched(): Row[] {
      let rows = getTable(tableName).filter((r) => filters.every((f) => f(r)))
      if (orderCol) {
        const col = orderCol
        rows = [...rows].sort((a, b) => {
          const av = a[col] as string | number
          const bv = b[col] as string | number
          const cmp = av < bv ? -1 : av > bv ? 1 : 0
          return orderAsc ? cmp : -cmp
        })
      }
      if (rangeFrom !== null && rangeTo !== null) rows = rows.slice(rangeFrom, rangeTo + 1)
      if (limitN !== null) rows = rows.slice(0, limitN)
      return rows
    }

    function applyWrite(): { data: Row[] | null; error: null } {
      if (mode === "insert") {
        const table = getTable(tableName)
        const inserted = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
          id: `${tableName}-${table.length + Math.random().toString(36).slice(2, 8)}`,
          ...r,
        }))
        table.push(...inserted)
        return { data: inserted, error: null }
      }
      if (mode === "update") {
        const targets = matched()
        for (const row of targets) Object.assign(row, payload)
        return { data: targets, error: null }
      }
      if (mode === "delete") {
        const table = getTable(tableName)
        const targets = new Set(matched())
        const remaining = table.filter((r) => !targets.has(r))
        tables.set(tableName, remaining)
        return { data: Array.from(targets), error: null }
      }
      return { data: matched(), error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select(_cols?: string, opts?: { count?: "exact"; head?: boolean }) {
        if (opts?.count === "exact") countExact = true
        return builder
      },
      insert(rows: Row | Row[]) {
        mode = "insert"
        payload = rows
        return builder
      },
      update(patch: Row) {
        mode = "update"
        payload = patch
        return builder
      },
      delete() {
        mode = "delete"
        return builder
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val)
        return builder
      },
      neq(col: string, val: unknown) {
        filters.push((r) => r[col] !== val)
        return builder
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]))
        return builder
      },
      is(col: string, val: null) {
        filters.push((r) => (r[col] ?? null) === val)
        return builder
      },
      not(col: string, op: string, val: unknown) {
        if (op === "is") {
          filters.push((r) => (r[col] ?? null) !== val)
        } else if (op === "in") {
          // PostgREST .not(col, "in", "(a,b,c)") — val is a literal
          // parenthesised, comma-separated string, not a JS array.
          const list = String(val).replace(/^\(|\)$/g, "").split(",")
          filters.push((r) => !list.includes(r[col] as string))
        } else {
          filters.push((r) => r[col] !== val)
        }
        return builder
      },
      gt(col: string, val: unknown) {
        filters.push((r) => (r[col] as number) > (val as number))
        return builder
      },
      gte(col: string, val: unknown) {
        filters.push((r) => (r[col] as string | number) >= (val as string | number))
        return builder
      },
      lt(col: string, val: unknown) {
        filters.push((r) => (r[col] as string | number) < (val as string | number))
        return builder
      },
      lte(col: string, val: unknown) {
        filters.push((r) => (r[col] as string | number) <= (val as string | number))
        return builder
      },
      contains(col: string, val: unknown[]) {
        filters.push((r) => Array.isArray(r[col]) && val.every((v) => (r[col] as unknown[]).includes(v)))
        return builder
      },
      // Real parser for the one PostgREST .or() shape this codebase actually
      // uses (src/lib/mou-report-reminders.ts's date-cutoff filter):
      // "and(col.not.is.null,col.lte.VALUE),and(col.is.null,col2.lte.VALUE)"
      // — comma-separated OR clauses, each either "and(...)" (comma-
      // separated AND conditions) or a bare "col.op.value" condition.
      or(expr: string) {
        filters.push((row) => evalOrExpr(expr, row))
        return builder
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col
        orderAsc = opts?.ascending ?? true
        return builder
      },
      limit(n: number) {
        limitN = n
        return builder
      },
      range(from: number, to: number) {
        rangeFrom = from
        rangeTo = to
        return builder
      },
      async maybeSingle() {
        // insert/update/delete must actually apply before reading the
        // result — .select("id").single() after .insert(...) is the whole
        // point of that chain, and matched() alone reads unmodified table
        // state.
        const rows = mode === "select" ? matched() : (applyWrite().data ?? [])
        return { data: rows[0] ?? null, error: null }
      },
      async single() {
        const rows = mode === "select" ? matched() : (applyWrite().data ?? [])
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not exactly one row" } }
      },
      // Supabase query builders are thenable — `await supabase.from(...).update(...).eq(...)`
      // resolves without an explicit terminal call. Mirror that so callers
      // that never call select()/maybeSingle() still get a resolved result.
      then(resolve: (v: { data: Row[] | null; error: null; count: number | null }) => void) {
        const result = applyWrite()
        const count = countExact ? matched().length : null
        resolve({ ...result, count })
      },
    }
    return builder
  }

  return {
    from,
    _tables: tables,
    _setTable(name: string, rows: Row[]) {
      tables.set(name, rows.map((r) => ({ ...r })))
    },
  }
}

export type MockSupabaseClient = ReturnType<typeof createMockSupabase>
