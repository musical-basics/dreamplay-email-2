import { Card, CardContent } from "@/components/ui/card"
import { Users, Mail, Clock, TrendingUp } from "lucide-react"

const metrics = [
    {
        title: "Total Subscribers",
        value: "1,326",
        trend: "+5% this week",
        icon: Users,
        trendUp: true,
    },
    {
        title: "Avg. Open Rate",
        value: "24.5%",
        trend: "+2.1% vs last month",
        icon: Mail,
        trendUp: true,
    },
    {
        title: "Next Scheduled Send",
        value: "Black Friday Round 4",
        trend: "Tomorrow, 9 AM",
        icon: Clock,
        trendUp: null,
    },
]

export function MetricsCards() {
    return (
        <div className="grid gap-4 md:grid-cols-3">
            {metrics.map((metric) => (
                <Card key={metric.title} className="bg-card border-border">
                    <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                            <div className="space-y-2">
                                <p className="text-sm text-muted-foreground">{metric.title}</p>
                                <p className="text-2xl font-bold text-card-foreground">{metric.value}</p>
                                <div className="flex items-center gap-1 text-xs">
                                    {metric.trendUp !== null && (
                                        <TrendingUp className={`h-3 w-3 ${metric.trendUp ? "text-green-500" : "text-red-500"}`} />
                                    )}
                                    <span className={metric.trendUp ? "text-green-500" : "text-muted-foreground"}>{metric.trend}</span>
                                </div>
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                                <metric.icon className="h-5 w-5 text-primary" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
