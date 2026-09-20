"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      offset={{ bottom: 57, right: 14 }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-background-active)",
          "--normal-text": "var(--color-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius-lg)",
          "--width": "320px",
        } as React.CSSProperties
      }
      toastOptions={{
        style: { padding: "12px 14px", gap: 12, border: 0, boxShadow: "0 8px 28px #0006", fontFamily: "var(--font-sans)" },
        actionButtonStyle: { background: "var(--color-secondary)", color: "var(--color-foreground)", height: 30, padding: "0 12px", borderRadius: "var(--radius)" },
      }}
      {...props}
    />
  )
}

export { Toaster }
