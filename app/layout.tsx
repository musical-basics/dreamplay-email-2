import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { WebsiteTracker } from "@/components/website-tracker"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans"
})
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono"
})

export const metadata: Metadata = {
  title: "Musical Basics Engine",
  description: "Email Marketing Command Center",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <WebsiteTracker />
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
