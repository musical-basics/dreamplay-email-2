import { createClient as createServiceClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

const MERGE_FIELDS = [
    "first_name", "last_name", "country", "country_code", "phone_code",
    "phone_number", "shipping_address1", "shipping_address2",
    "shipping_city", "shipping_zip", "shipping_province",
] as const

type MergeField = typeof MERGE_FIELDS[number]

interface CsvRow {
    email: string
    workspace: string
    first_name: string
    last_name: string
    country: string
    country_code: string
    phone_code: string
    phone_number: string
    shipping_address1: string
    shipping_address2: string
    shipping_city: string
    shipping_zip: string
    shipping_province: string
    tags: string[]
    status: string
}

export async function POST(request: Request) {
    try {
        const { workspace, rows } = await request.json() as { workspace: string; rows: CsvRow[] }

        if (!workspace || !Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json({ error: "workspace and rows are required" }, { status: 400 })
        }

        const supabase = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_KEY!
        )

        // ── Step 1: Fetch all existing subscribers for this workspace in one pass ──
        const emailList = rows.map(r => r.email)
        const existingMap = new Map<string, { id: string; tags: string[] }>()

        for (let i = 0; i < emailList.length; i += 500) {
            const batch = emailList.slice(i, i + 500)
            const { data, error } = await supabase
                .from("subscribers")
                .select("id, email, tags")
                .eq("workspace", workspace)
                .in("email", batch)

            if (error) throw new Error(error.message)
            for (const row of data ?? []) {
                existingMap.set(row.email, { id: row.id, tags: row.tags ?? [] })
            }
        }

        // ── Step 2: Split into inserts vs updates ──
        const toInsert: CsvRow[] = []
        const toUpdate: { id: string; payload: Partial<CsvRow> & { tags: string[] } }[] = []

        for (const csvRow of rows) {
            const existing = existingMap.get(csvRow.email)

            if (existing) {
                // Merge: only overwrite non-empty fields, union tags
                const updates: Record<string, any> = {}
                for (const f of MERGE_FIELDS) {
                    if (csvRow[f]) updates[f] = csvRow[f]
                }
                const mergedTags = [...new Set([...existing.tags, ...csvRow.tags])]
                updates.tags = mergedTags
                if (csvRow.status) updates.status = csvRow.status
                toUpdate.push({ id: existing.id, payload: updates as any })
            } else {
                toInsert.push(csvRow)
            }
        }

        // ── Step 3: Insert new subscribers in batches ──
        // Use upsert with ignoreDuplicates as a safety net against any race conditions
        let addedCount = 0
        for (let i = 0; i < toInsert.length; i += 500) {
            const chunk = toInsert.slice(i, i + 500)
            const { error } = await supabase
                .from("subscribers")
                .upsert(chunk, { onConflict: "email,workspace", ignoreDuplicates: true })

            if (error) throw new Error(error.message)
            addedCount += chunk.length
        }

        // ── Step 4: Update existing subscribers ──
        let updatedCount = 0
        for (const { id, payload } of toUpdate) {
            const { error } = await supabase
                .from("subscribers")
                .update(payload)
                .eq("id", id)

            if (error) {
                console.error(`[import-subscribers] Failed to update subscriber ${id}:`, error.message)
            } else {
                updatedCount++
            }
        }

        const skipped = rows.length - addedCount - updatedCount

        return NextResponse.json({ added: addedCount, updated: updatedCount, skipped })
    } catch (err: any) {
        console.error("[import-subscribers] Error:", err)
        return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 })
    }
}
