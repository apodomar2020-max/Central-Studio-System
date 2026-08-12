import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 focus-visible:border-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0 active:scale-[.975]",
  {
    variants: {
      variant: {
        default:
          "border-primary-border bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(0,182,215,.16)] hover:bg-[#18c4e1] hover:shadow-[0_14px_30px_rgba(0,182,215,.22)]",
        destructive:
          "border-destructive-border bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/88",
        outline:
          "border-[var(--button-outline)] bg-transparent text-foreground shadow-xs hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border-secondary-border bg-secondary text-secondary-foreground hover:border-foreground/15 hover:bg-accent",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        export:
          "border-primary/30 bg-primary/10 text-primary hover:border-primary/55 hover:bg-primary/16 hover:text-[#61d9ed]",
        link: "border-transparent bg-transparent p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-[34px] rounded-[10px] px-3 text-xs",
        compact: "min-h-[30px] rounded-[9px] px-2.5 text-[11px]",
        lg: "min-h-11 rounded-xl px-8",
        icon: "h-10 w-10 rounded-xl",
        iconSm: "h-[34px] w-[34px] rounded-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? children : <>{loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{children}</>}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
