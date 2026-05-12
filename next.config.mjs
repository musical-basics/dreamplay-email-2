/** @type {import('next').NextConfig} */
const nextConfig = {
    typescript: {
        ignoreBuildErrors: true,
    },
    images: {
        unoptimized: true,
    },
    experimental: {
        serverActions: {
            bodySizeLimit: '50mb',
        },
    },
    async headers() {
        return [
            {
                // Hosted email-attribution beacon. Short cache so updates
                // propagate to consuming landing pages within ~5 minutes
                // without rebuild. Permissive CORS so any landing page
                // can <script src> this. email.dreamplaypianos.com (and
                // other tracking CNAMEs that alias this Vercel project)
                // serve this file at /track-attribution.js.
                source: "/track-attribution.js",
                headers: [
                    {
                        key: "Cache-Control",
                        value: "public, max-age=300, s-maxage=300, must-revalidate",
                    },
                    { key: "Access-Control-Allow-Origin", value: "*" },
                    { key: "Content-Type", value: "application/javascript; charset=utf-8" },
                ],
            },
        ];
    },
}

export default nextConfig
