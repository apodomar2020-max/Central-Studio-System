import { useGetStudent } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

export default function ParentDetailPage() {
  const { can } = useAdminAuth();
  const canViewChildren = can("children", "view");
  const { id } = useParams<{ id: string }>();
  const parentId = parseInt(id ?? "", 10);
  const { data: parent, isLoading, error } = useGetStudent(parentId);

  if (isLoading) {
    return <div className="py-8 text-center">Loading parent details...</div>;
  }

  if (error || !parent) {
    return (
      <div className="py-8 text-center text-destructive">
        Failed to load parent record.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/parents">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to Parents
          </Button>
        </Link>
      </div>

      <PageHeader
        title={parent.name}
        description="Parent Profile Details"
        mode="studio"
      />

      <div className="grid gap-6 md:grid-cols-3">
        {/* Parent Details Card */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Name</div>
              <div className="text-base">{parent.name}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Email</div>
              <div className="text-base">{parent.email}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Phone</div>
              <div className="text-base">{parent.phone || "—"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Account Type</div>
              <div className="text-base capitalize">{parent.accountType || "parent"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Join Date</div>
              <div className="text-base">
                {new Date(parent.joinedAt).toLocaleDateString()}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Children Card */}
        {canViewChildren && <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Children Profiles</CardTitle>
          </CardHeader>
          <CardContent>
            {(!parent.children || parent.children.length === 0) ? (
              <div className="py-6 text-center text-muted-foreground">
                No children registered under this parent account.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {parent.children.map((child: any) => (
                  <Link
                    key={child.id}
                    href={`/parents/${parent.id}/children/${child.id}`}
                  >
                    <div className="flex items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-accent/10 transition-colors">
                      <div className="space-y-1">
                        <div className="font-semibold">{child.fullName}</div>
                        <div className="text-xs text-muted-foreground">
                          {child.gender === "female" ? "Girl" : "Boy"} · Age {child.age ?? "—"}
                        </div>
                        {child.birthday && (
                          <div className="text-xs text-muted-foreground">
                            Born: {child.birthday}
                          </div>
                        )}
                        {(child.emergencyName || child.emergencyPhone) && (
                          <div className="text-[11px] text-muted-foreground">
                            Emergency: {child.emergencyName || ""} ({child.emergencyPhone || ""})
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>}
      </div>
    </div>
  );
}
