import { AppSidebar } from "@/components/app-sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { LockScreen } from "@/components/lock-screen"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <LockScreen>
            <div className="min-h-screen bg-background">
                <AppSidebar />
                <main className="pl-64">
                    <DashboardHeader />
                    {children}
                </main>
            </div>
        </LockScreen>
    )
}
