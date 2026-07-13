/**
 * Ballet → Students — /ballet/students  (Phase B / A5)
 *
 * The enrolled-students roster. A "student" is a ballet application whose
 * status is exactly "active"; the three-part activation gate guarantees such
 * a row already has an assigned level, an assigned group, and a paid payment,
 * so the backing route (GET /admin/ballet/students) filters on status alone.
 *
 * "Date Joined" is the current active level assignment's enrolledAt (when the
 * child became a student), not the application's createdAt. "Edit" simply
 * navigates to that application's existing detail page — no separate edit
 * surface. Reuses the ballet.applications "view" permission.
 *
 * Follows the raw-fetch + server-pagination pattern of ApplicationsPage.tsx.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ChevronLeft, ChevronRight, Pencil } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudentRow {
  applicationId: number;
  studentName: string;
  parentName: string;
  age: number | null;
  dateJoined: string | null;
  levelId: number | null;
  levelName: string | null;
  groupId: number | null;
  groupName: string | null;
}

interface ListResponse {
  data: StudentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const LIMIT = 20;

export default function BalletStudentsPage() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["ballet-students", page, token],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      const res = await fetch(`${API_BASE}/api/admin/ballet/students?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load students");
      return res.json();
    },
  });

  const dash = <span className="italic text-muted-foreground">—</span>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ballet Students"
        description="Actively enrolled ballet students"
        mode="stage"
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student Name</TableHead>
              <TableHead>Date Joined</TableHead>
              <TableHead>Parent Name</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Group</TableHead>
              <TableHead className="w-16 text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-destructive text-sm">
                  Failed to load students.
                </TableCell>
              </TableRow>
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                  No active ballet students yet.
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((s) => (
                <TableRow
                  key={s.applicationId}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/ballet/applications/${s.applicationId}`)}
                >
                  <TableCell className="font-medium">{s.studentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.dateJoined ? new Date(s.dateJoined).toLocaleDateString() : dash}
                  </TableCell>
                  <TableCell>{s.parentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.age ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.levelName ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.groupName ?? dash}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Edit student ${s.applicationId}`}
                      onClick={(e) => { e.stopPropagation(); navigate(`/ballet/applications/${s.applicationId}`); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, data.total)} of {data.total}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center px-2 text-xs">
              {page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
