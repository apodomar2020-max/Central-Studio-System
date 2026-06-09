/**
 * System Users page — Super Admin only.
 * Allows creating admin users and assigning roles.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth, type AdminUser } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Pencil, ShieldCheck, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean }>;
}

interface SystemUserRow {
  id: number;
  username: string;
  email: string;
  fullName: string;
  roleId: number | null;
  isSuperAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useSystemUsers() {
  const { token } = useAdminAuth();
  return useQuery<SystemUserRow[]>({
    queryKey: ["admin-system-users"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/users`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });
}

function useRoles() {
  const { token } = useAdminAuth();
  return useQuery<Role[]>({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/roles`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load roles");
      return res.json();
    },
  });
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
  roles: Role[];
}

function CreateUserDialog({ open, onClose, roles }: CreateUserDialogProps) {
  const { token } = useAdminAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState({ username: "", email: "", fullName: "", password: "", roleId: "" });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        username: form.username.trim().toLowerCase(),
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        password: form.password,
        ...(form.roleId ? { roleId: parseInt(form.roleId) } : {}),
      };
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        method: "POST",
        headers: makeHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-system-users"] });
      toast({ title: "User created successfully" });
      setForm({ username: "", email: "", fullName: "", password: "", roleId: "" });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Admin User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. john_doe" />
            </div>
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="John Doe" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min. 8 characters" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="No role (no permissions)" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => { setError(null); mutation.mutate(); }}
            disabled={mutation.isPending || !form.username || !form.password || !form.fullName || !form.email}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditUserDialogProps {
  user: SystemUserRow;
  open: boolean;
  onClose: () => void;
  roles: Role[];
}

function EditUserDialog({ user, open, onClose, roles }: EditUserDialogProps) {
  const { token, user: currentUser } = useAdminAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState({
    fullName: user.fullName,
    email: user.email,
    roleId: user.roleId ? String(user.roleId) : "",
    isActive: user.isActive,
    password: "",
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        roleId: form.roleId ? parseInt(form.roleId) : null,
        isActive: form.isActive,
      };
      if (form.password.trim()) body["password"] = form.password;

      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: makeHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to update user");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-system-users"] });
      toast({ title: "User updated" });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const isSelf = currentUser?.id === user.id;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User — {user.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          {!user.isSuperAdmin && (
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="No role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>New Password (leave blank to keep current)</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </div>
          {!isSelf && !user.isSuperAdmin && (
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              />
              <Label>{form.isActive ? "Account active" : "Account deactivated"}</Label>
            </div>
          )}
          {isSelf && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              You cannot deactivate your own account.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { setError(null); mutation.mutate(); }} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemUsersPage() {
  const { user: currentUser } = useAdminAuth();
  const usersQuery = useSystemUsers();
  const rolesQuery = useRoles();
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<SystemUserRow | null>(null);

  if (!currentUser?.isSuperAdmin) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center space-y-2">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Super Admin access required to view this page.</p>
        </div>
      </div>
    );
  }

  const roles = rolesQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="System Users"
        description="Manage admin accounts and their roles."
        mode="stage"
        addLabel="New User"
        onAdd={() => setShowCreate(true)}
      />

      {usersQuery.isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {usersQuery.isError && (
        <p className="text-destructive text-sm">Failed to load users.</p>
      )}

      {usersQuery.data && (
        <div className="rounded-md border mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Full Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.data.map((u) => {
                const role = roles.find((r) => r.id === u.roleId);
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.username}
                      {u.isSuperAdmin && (
                        <Badge variant="secondary" className="ml-2 text-xs">Super Admin</Badge>
                      )}
                    </TableCell>
                    <TableCell>{u.fullName}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{role ? role.name : <span className="text-muted-foreground text-xs">No role</span>}</TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? "default" : "outline"}>
                        {u.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => setEditTarget(u)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog open={showCreate} onClose={() => setShowCreate(false)} roles={roles} />
      {editTarget && (
        <EditUserDialog
          user={editTarget}
          open={true}
          onClose={() => setEditTarget(null)}
          roles={roles}
        />
      )}
    </>
  );
}
