import { useListStudents } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/layout/page-header";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

export default function ParentsPage() {
  const { data: students, isLoading } = useListStudents();

  // Filter parents: accountType === "parent"
  const parents = students?.filter((s) => s.accountType === "parent") ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Parents" description="Manage parent accounts and children profiles" mode="studio" />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Children Count</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : parents.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No parent accounts found.</TableCell></TableRow>
            ) : (
              parents.map((parent) => (
                <TableRow key={parent.id} data-testid={`row-parent-${parent.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/parents/${parent.id}`} className="hover:underline flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        {parent.avatarUrl ? <AvatarImage src={parent.avatarUrl} alt={parent.name} /> : null}
                        <AvatarFallback>{parent.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span>{parent.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{parent.email}</div>
                    <div className="text-xs text-muted-foreground">{parent.phone}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {parent.childCount ?? 0} {parent.childCount === 1 ? "Child" : "Children"}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(parent.joinedAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
