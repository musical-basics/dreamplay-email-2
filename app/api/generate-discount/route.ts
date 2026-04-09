import { NextResponse } from "next/server";
import { createShopifyDiscount } from "@/app/actions/shopify-discount";

/**
 * POST /api/generate-discount
 * 
 * Generates a unique Shopify discount code.
 * Called by the website when someone signs up via the $300 Off popup.
 * 
 * Body: { type, value, durationDays, codePrefix, usageLimit? }
 * Returns: { success, code } or { success: false, error }
 */
export async function POST(request: Request) {
    try {
        // Simple auth: require a shared secret
        const authHeader = request.headers.get("authorization");
        const expectedToken = process.env.INTERNAL_API_SECRET;

        if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { type, value, durationDays, codePrefix, usageLimit } = body;

        if (!type || !value || !durationDays || !codePrefix) {
            return NextResponse.json(
                { error: "Missing required fields: type, value, durationDays, codePrefix" },
                { status: 400 }
            );
        }

        const result = await createShopifyDiscount({
            type,
            value,
            durationDays,
            codePrefix,
            usageLimit: usageLimit ?? 1,
        });

        if (!result.success) {
            console.error("[generate-discount] Shopify error:", result.error);
            return NextResponse.json({ success: false, error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, code: result.code });
    } catch (error: any) {
        console.error("[generate-discount] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
