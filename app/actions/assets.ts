"use server"

import { createClient } from "@supabase/supabase-js"
import { createHash } from "crypto"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

function getSupabase() {
    return createClient(supabaseUrl, supabaseServiceKey)
}

// ─────────────────────────────────────────────
//  UPLOAD — Content-Addressable (SHA-256 hash)
// ─────────────────────────────────────────────

export async function uploadHashedAsset(formData: FormData, folderPath: string) {
    const supabase = getSupabase()
    const file = formData.get("file") as File
    if (!file) return { success: false, error: "No file provided" }

    // 1. Hash file content → deterministic filename
    const buffer = await file.arrayBuffer()
    const hashHex = createHash("sha256").update(Buffer.from(buffer)).digest("hex")
    const ext = file.name.substring(file.name.lastIndexOf("."))
    const storageFilename = `${hashHex}${ext}`

    // 2. Upload to bucket (silently deduplicates — upsert: false ignores if exists)
    await supabase.storage
        .from("email-assets")
        .upload(storageFilename, Buffer.from(buffer), {
            contentType: file.type,
            upsert: false,
        })

    // 3. Build permanent public URL
    const { data: urlData } = supabase.storage
        .from("email-assets")
        .getPublicUrl(storageFilename)

    // 4. Create DB record (user-facing view)
    const { data, error } = await supabase
        .from("media_assets")
        .insert({
            filename: file.name,
            folder_path: folderPath || "",
            storage_hash: storageFilename,
            public_url: urlData.publicUrl,
            size: file.size,
            is_deleted: false,
        })
        .select()
        .single()

    if (error) return { success: false, error: error.message }
    return { success: true, asset: data }
}

// ─────────────────────────────────────────────
//  SOFT DELETE — bucket files are NEVER removed
// ─────────────────────────────────────────────

export async function deleteAsset(assetId: string) {
    const supabase = getSupabase()
    const { error } = await supabase
        .from("media_assets")
        .update({ is_deleted: true })
        .eq("id", assetId)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

export async function deleteAssets(assetIds: string[]) {
    const supabase = getSupabase()
    const { error } = await supabase
        .from("media_assets")
        .update({ is_deleted: true })
        .in("id", assetIds)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

// ─────────────────────────────────────────────
//  VIRTUAL MOVE — only changes folder_path in DB
// ─────────────────────────────────────────────

export async function moveAsset(assetId: string, newFolderPath: string) {
    const supabase = getSupabase()
    const { error } = await supabase
        .from("media_assets")
        .update({ folder_path: newFolderPath })
        .eq("id", assetId)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

export async function moveAssets(assetIds: string[], newFolderPath: string) {
    const supabase = getSupabase()
    const { error } = await supabase
        .from("media_assets")
        .update({ folder_path: newFolderPath })
        .in("id", assetIds)

    if (error) return { success: false, error: error.message }
    return { success: true }
}

// ─────────────────────────────────────────────
//  QUERY — fetch assets & folders from DB
// ─────────────────────────────────────────────

export async function getAssets(folderPath: string) {
    const supabase = getSupabase()

    const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("folder_path", folderPath || "")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })

    if (error) return { assets: [], error: error.message }
    return { assets: data || [] }
}

export async function getFolders() {
    const supabase = getSupabase()

    // Get all distinct folder_paths that have active assets
    const { data, error } = await supabase
        .from("media_assets")
        .select("folder_path")
        .eq("is_deleted", false)
        .neq("folder_path", "")

    if (error) return { folders: [], error: error.message }

    // Extract unique top-level folder names
    const folderSet = new Set<string>()
    for (const row of data || []) {
        const parts = row.folder_path.split("/")
        if (parts[0]) folderSet.add(parts[0])
    }

    return { folders: Array.from(folderSet).sort() }
}

export async function getSubFolders(parentPath: string) {
    const supabase = getSupabase()

    const { data, error } = await supabase
        .from("media_assets")
        .select("folder_path")
        .eq("is_deleted", false)
        .like("folder_path", `${parentPath}/%`)

    if (error) return { folders: [], error: error.message }

    // Extract the next-level folder names relative to parentPath
    const folderSet = new Set<string>()
    for (const row of data || []) {
        const relative = row.folder_path.substring(parentPath.length + 1)
        const nextPart = relative.split("/")[0]
        if (nextPart) folderSet.add(nextPart)
    }

    return { folders: Array.from(folderSet).sort() }
}

// ─────────────────────────────────────────────
//  FOLDER OPERATIONS — virtual (DB-only)
// ─────────────────────────────────────────────

export async function createFolder(name: string) {
    // Folders exist implicitly via folder_path on assets.
    // To create an "empty" folder, we insert a sentinel record.
    const supabase = getSupabase()

    const { error } = await supabase
        .from("media_assets")
        .insert({
            filename: ".folder",
            folder_path: name,
            storage_hash: ".folder",
            public_url: "",
            size: 0,
            is_deleted: false,
        })

    if (error) return { success: false, error: error.message }
    return { success: true }
}

export async function deleteFolder(name: string) {
    // Soft-delete all assets in this folder (and subfolders)
    const supabase = getSupabase()

    // Delete assets exactly in this folder
    const { error: exactError } = await supabase
        .from("media_assets")
        .update({ is_deleted: true })
        .eq("folder_path", name)
        .eq("is_deleted", false)

    if (exactError) return { success: false, error: exactError.message }

    // Delete assets in subfolders
    const { error: subError } = await supabase
        .from("media_assets")
        .update({ is_deleted: true })
        .like("folder_path", `${name}/%`)
        .eq("is_deleted", false)

    if (subError) return { success: false, error: subError.message }
    return { success: true }
}
