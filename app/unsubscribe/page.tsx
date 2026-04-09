import { UnsubscribeConfirm } from "./unsubscribe-confirm";

export default async function UnsubscribePage({
    searchParams,
}: {
    searchParams: Promise<{ s?: string; c?: string }>;
}) {
    const resolvedParams = await searchParams; // Next.js 15+ async searchParams
    const subscriberId = resolvedParams.s;
    const campaignId = resolvedParams.c;

    if (!subscriberId) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <div className="text-center p-8 bg-white rounded-lg shadow-sm border border-gray-100">
                    <p className="text-gray-500">Invalid unsubscribe link.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8 border border-gray-100">
                <UnsubscribeConfirm subscriberId={subscriberId} campaignId={campaignId} />
            </div>
        </div>
    );
}
