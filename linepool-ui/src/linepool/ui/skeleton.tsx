// Source: shadcn/ui new-york-v4 (MIT), https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json
import { cn } from "./utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
