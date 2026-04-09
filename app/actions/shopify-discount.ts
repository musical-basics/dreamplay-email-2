"use server"

// Cache the token in memory (valid for 24 hours per Shopify docs)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
        return cachedToken.token;
    }

    const shopDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!shopDomain || !clientId || !clientSecret) {
        throw new Error("Missing env vars: SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET");
    }

    const cleanDomain = shopDomain.replace('.myshopify.com', '') + '.myshopify.com';

    const res = await fetch(`https://${cleanDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token request failed (${res.status}): ${text.substring(0, 200)}`);
    }

    const data = await res.json();

    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 86399) * 1000
    };

    return data.access_token;
}

// ─── Generic discount generator ───────────────────────────

export interface DiscountConfig {
    type: "percentage" | "fixed_amount"
    value: number
    durationDays: number
    codePrefix: string
    usageLimit?: number
    expiresOn?: string // ISO date string, e.g. "2026-04-01" — overrides durationDays when set
}

export async function createShopifyDiscount(config: DiscountConfig) {
    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;

    if (!shopifyDomain) {
        return { success: false, error: "Missing SHOPIFY_STORE_DOMAIN" };
    }

    const cleanDomain = shopifyDomain.replace('.myshopify.com', '') + '.myshopify.com';

    const uniqueSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const discountCode = `${config.codePrefix}-${uniqueSuffix}`;

    const startsAt = new Date().toISOString();
    const endsAt = config.expiresOn
        ? new Date(config.expiresOn + "T23:59:59Z").toISOString()
        : new Date(Date.now() + config.durationDays * 24 * 60 * 60 * 1000).toISOString();

    const payload = {
        price_rule: {
            title: discountCode,
            target_type: "line_item",
            target_selection: "all",
            allocation_method: "across",
            value_type: config.type,
            value: `-${config.value}.0`,
            customer_selection: "all",
            usage_limit: config.usageLimit ?? 1,
            starts_at: startsAt,
            ends_at: endsAt
        }
    };

    try {
        const accessToken = await getAccessToken();
        const headers = {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken
        };

        const prRes = await fetch(`https://${cleanDomain}/admin/api/2024-01/price_rules.json`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!prRes.ok) {
            const errText = await prRes.text();
            throw new Error(`Price Rule Error (${prRes.status}): ${errText.substring(0, 200)}`);
        }

        const prData = await prRes.json();
        const priceRuleId = prData.price_rule.id;

        const dcRes = await fetch(`https://${cleanDomain}/admin/api/2024-01/price_rules/${priceRuleId}/discount_codes.json`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ discount_code: { code: discountCode } })
        });

        if (!dcRes.ok) throw new Error("Failed to create the discount code in Shopify.");

        return { success: true, code: discountCode };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// ─── Legacy wrappers (keep existing buttons working) ──────

export async function generateShopifyDiscount(percentage: number = 5) {
    return createShopifyDiscount({
        type: "percentage",
        value: percentage,
        durationDays: 2,
        codePrefix: `VIP${percentage}`,
    });
}

export async function generateShopifyFixedDiscount(amount: number = 30) {
    return createShopifyDiscount({
        type: "fixed_amount",
        value: amount,
        durationDays: 14,
        codePrefix: `SAVE${amount}`,
    });
}
