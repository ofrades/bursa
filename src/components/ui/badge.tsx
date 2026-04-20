import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "#/lib/utils";

const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-white focus-visible:ring-destructive/20",
        outline: "border-border bg-background text-foreground",
        ghost: "bg-muted text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

// ─── Signal badge — BUY | SELL only ──────────────────────────────────────────
// Legacy values (STRONG_BUY, HOLD, etc.) are mapped gracefully.

export type Signal = "BUY" | "SELL";

const signalBadgeClasses: Record<string, string> = {
  BUY: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-400",
  SELL: "border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-400",
  // Legacy mappings
  STRONG_BUY:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-400",
  HOLD: "border-border bg-muted text-muted-foreground",
  STRONG_SELL:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-400",
};

const signalLabel: Record<string, string> = {
  BUY: "BUY",
  SELL: "SELL",
  STRONG_BUY: "BUY", // legacy → normalised label
  HOLD: "HOLD",
  STRONG_SELL: "SELL",
};

function SignalBadge({ signal, className }: { signal: string; className?: string }) {
  const classes = signalBadgeClasses[signal] ?? signalBadgeClasses.HOLD;
  const label = signalLabel[signal] ?? signal.replaceAll("_", " ");
  return (
    <Badge variant="outline" className={cn(classes, className)}>
      {label}
    </Badge>
  );
}

// ─── Cycle badge — ACCUMULATION | MARKUP | DISTRIBUTION | MARKDOWN ───────────

export type Cycle = "ACCUMULATION" | "MARKUP" | "DISTRIBUTION" | "MARKDOWN";

const cycleBadgeClasses: Record<Cycle, string> = {
  ACCUMULATION:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/40 dark:text-sky-400",
  MARKUP:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-400",
  DISTRIBUTION:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-400",
  MARKDOWN:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-400",
};

const cycleEmoji: Record<Cycle, string> = {
  ACCUMULATION: "📦",
  MARKUP: "🚀",
  DISTRIBUTION: "⚠️",
  MARKDOWN: "📉",
};

function CycleBadge({
  cycle,
  timeframe,
  className,
}: {
  cycle: Cycle;
  timeframe?: string | null;
  className?: string;
}) {
  const classes = cycleBadgeClasses[cycle] ?? "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn(classes, className)}>
      {cycleEmoji[cycle]} {cycle}
      {timeframe ? ` · ${timeframe}` : ""}
    </Badge>
  );
}

// ─── Supervisor badge ─────────────────────────────────────────────────────────

export type SupervisorSeverity = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

const supervisorSeverityClasses: Record<SupervisorSeverity, string> = {
  LOW: "border-border bg-muted text-muted-foreground",
  MEDIUM:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-400",
  HIGH: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/40 dark:bg-orange-950/40 dark:text-orange-400",
  EXTREME:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800/40 dark:bg-red-950/40 dark:text-red-300 font-bold",
};

function SupervisorBadge({
  supervisor,
  severity,
  className,
}: {
  supervisor: "TALEB" | "BUFFETT";
  severity: SupervisorSeverity;
  className?: string;
}) {
  const label = supervisor === "TALEB" ? "🦢 Taleb" : "🎩 Buffett";
  const classes = supervisorSeverityClasses[severity] ?? supervisorSeverityClasses.LOW;
  return (
    <Badge variant="outline" className={cn(classes, className)}>
      {label} · {severity}
    </Badge>
  );
}

export { Badge, badgeVariants, SignalBadge, CycleBadge, SupervisorBadge };
