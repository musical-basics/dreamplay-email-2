import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Initialize Supabase with Service Key to bypass RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        // 1. Generate unique path
        // Sanitize filename
        const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, '');
        const path = `chat-uploads/${Date.now()}-${filename}`;

        // 2. Upload to Supabase Storage using Admin Client
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { data, error } = await supabase.storage
            .from('chat-assets')
            .upload(path, buffer, {
                contentType: file.type,
                upsert: false
            });

        if (error) {
            console.error("Supabase Storage Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // 3. Get Public URL
        const { data: publicUrlData } = supabase.storage
            .from('chat-assets')
            .getPublicUrl(path);

        return NextResponse.json({
            success: true,
            url: publicUrlData.publicUrl
        });

    } catch (error: any) {
        console.error("Upload Route Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
