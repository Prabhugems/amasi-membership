const BASE_URL = "https://api.airtable.com/v0"

export const AIRTABLE_BASE_ID = "appFOBQXh545T7zg0"
export const TABLE_FMASIANS = "tblf085EgnmIaG8sz"
export const TABLE_SKILL_COURSE = "tblBU1hkL7orELHsD"

interface AirtableRaw {
  id: string
  fields: Record<string, unknown>
}

interface AirtableListResponse {
  records: AirtableRaw[]
  offset?: string
}

function pat(): string {
  const p = process.env.AIRTABLE_PAT
  if (!p) throw new Error("AIRTABLE_PAT not set in environment")
  return p
}

// Generator that yields each record across all pages of a table.
// Airtable returns up to 100 records per page; pagination via 'offset'.
export async function* listAllRecords(
  tableId: string,
  opts: { fields?: string[]; pageSize?: number } = {}
): AsyncGenerator<AirtableRaw, void, unknown> {
  const url = new URL(`${BASE_URL}/${AIRTABLE_BASE_ID}/${tableId}`)
  url.searchParams.set("pageSize", String(opts.pageSize ?? 100))
  if (opts.fields) {
    for (const f of opts.fields) url.searchParams.append("fields[]", f)
  }
  let offset: string | undefined
  do {
    if (offset) url.searchParams.set("offset", offset)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat()}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable ${tableId} ${res.status}: ${text}`)
    }
    const json = (await res.json()) as AirtableListResponse
    for (const rec of json.records) yield rec
    offset = json.offset
  } while (offset)
}

// Download a binary attachment. Airtable attachment URLs are signed and expire,
// so this must be called within the same run as the listing.
export async function downloadAttachment(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Attachment fetch ${res.status}`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}
