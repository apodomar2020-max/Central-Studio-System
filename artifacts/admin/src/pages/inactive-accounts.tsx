import { useEffect } from "react";
import { Link } from "wouter";
import {
  useListStudents,
  getListStudentsQueryKey,
} from "@workspace/api-client-react";
import {
  UsersDirectoryControls,
  useUsersDirectory,
} from "@/components/admin/users-directory-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TablePagination } from "@/components/shared/table-pagination";
import "./admin2-operations.css";

export default function InactiveAccounts() {
  const controls = useUsersDirectory("inactive");
  const { data, isLoading, isError } = useListStudents(controls.params, {
    query: {
      queryKey: getListStudentsQueryKey(controls.params),
      enabled: !controls.invalidDateRange,
    },
  });
  const rows = data?.students ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? controls.page;
  const pages = data?.totalPages ?? 0;
  useEffect(() => {
    if (data && controls.page > Math.max(1, data.totalPages))
      controls.setPage(Math.max(1, data.totalPages));
  }, [data, controls.page, controls.setPage]);
  return (
    <div className="admin2-ops-page admin2-inactive-accounts">
      <UsersDirectoryControls controls={controls} />
      <div className="admin2-people-registry">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Account Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {controls.invalidDateRange ? (
              <TableRow>
                <TableCell colSpan={5} role="alert">
                  Select a valid joined-date range.
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={5}>Loading...</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={5} role="alert">
                  Inactive accounts could not be loaded. Try again in a moment.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  No inactive accounts match these controls.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/${account.accountType === "parent" ? "parents" : "students"}/${account.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar className="h-9 w-9">
                        {account.avatarUrl && (
                          <AvatarImage src={account.avatarUrl} alt="" />
                        )}
                        <AvatarFallback>
                          {account.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {account.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{account.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {account.phone}
                    </div>
                  </TableCell>
                  <TableCell>
                    {account.accountType === "parent"
                      ? "Parent"
                      : account.accountType === "student"
                        ? "Student"
                        : "Student (legacy / unassigned)"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        account.accountStatus === "deleted"
                          ? "border-transparent bg-red-500/15 text-red-400"
                          : "border-transparent bg-amber-500/15 text-amber-400"
                      }
                    >
                      {account.accountStatus === "deleted"
                        ? "Deleted"
                        : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(account.joinedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <TablePagination
        page={page}
        totalPages={pages}
        total={total}
        pageSize={controls.pageSize}
        isLoading={isLoading || controls.invalidDateRange}
        itemLabel="inactive accounts"
        label="Inactive accounts pagination"
        onPageChange={controls.setPage}
      />
    </div>
  );
}
