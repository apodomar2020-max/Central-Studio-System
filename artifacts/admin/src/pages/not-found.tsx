import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Admin 2.0: this used to be pure pre-migration shadcn defaults
// (bg-gray-50/text-gray-900/text-gray-600) — invisible on the dark canvas
// since the Card itself picks up the theme's near-black --card background
// while the heading forced a near-black text color on top of it. Now uses
// the same semantic tokens and premium-card treatment as every other
// canonical Admin 2.0 surface, in both themes.
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center">
      <Card className="premium-card relative w-full max-w-md overflow-hidden">
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            This page doesn't exist or you may not have permission to view it.
          </p>

          <Button asChild className="mt-6">
            <Link href="/">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
