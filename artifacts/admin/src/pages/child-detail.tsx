import { useGetStudent } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ChildDetailPage() {
  const { parentId: pId, childId: cId } = useParams<{ parentId: string; childId: string }>();
  const parentId = parseInt(pId ?? "", 10);
  const childId = parseInt(cId ?? "", 10);

  const { data: parent, isLoading, error } = useGetStudent(parentId);

  if (isLoading) {
    return <div className="py-8 text-center">Loading child details...</div>;
  }

  if (error || !parent) {
    return (
      <div className="py-8 text-center text-destructive">
        Failed to load parent details.
      </div>
    );
  }

  const child = parent.children?.find((c: any) => c.id === childId);

  if (!child) {
    return (
      <div className="py-8 text-center text-destructive">
        Child profile not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/parents/${parentId}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to Parent Details
          </Button>
        </Link>
      </div>

      <PageHeader
        title={child.fullName}
        description="Child Profile Details"
        mode="studio"
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Child Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Child Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Full Name</div>
              <div className="text-base font-semibold">{child.fullName}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Age</div>
              <div className="text-base">{child.age ?? "—"} years old</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Date of Birth</div>
              <div className="text-base">{child.birthday || "—"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Gender</div>
              <div className="text-base capitalize">{child.gender}</div>
            </div>
            {child.medicalNotes && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">Medical Notes</div>
                <div className="text-base text-muted-foreground break-words">{child.medicalNotes}</div>
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-muted-foreground">Emergency Contact Name</div>
              <div className="text-base">{child.emergencyName || "—"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Emergency Contact Phone</div>
              <div className="text-base">{child.emergencyPhone || "—"}</div>
            </div>
          </CardContent>
        </Card>

        {/* Parent Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Parent Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Parent Name</div>
              <div className="text-base font-medium">
                <Link href={`/parents/${parent.id}`} className="hover:underline text-[#00B6D7]">
                  {parent.name}
                </Link>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Parent Email</div>
              <div className="text-base">{parent.email}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Parent Phone</div>
              <div className="text-base">{parent.phone || "—"}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
