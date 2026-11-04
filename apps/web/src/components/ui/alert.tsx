import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex gap-2.5 rounded-md p-3 text-[13px] leading-snug", {
  variants: {
    variant: {
      warning: "bg-warning/10 text-warning",
      destructive: "bg-destructive/10 text-destructive-foreground",
    },
  },
  defaultVariants: { variant: "warning" },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant, className }))} {...props} />;
}

export { Alert };
