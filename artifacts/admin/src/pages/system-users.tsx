/**
 * System Users & Roles page — Super Admin only.
 * Tab 1 — Users: create/edit admin accounts, assign roles.
 * Tab 2 — Roles: visual permission matrix builder per module.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Loader2, Pencil, ShieldCheck, AlertTriangle, Plus, Trash2 } from "lucide-react";
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

// ── Module definitions ────────────────────────────────────────────────────────

const MODULES = [
  { key: "dashboard",      label: "Dashboard" },
  { key: "instructors",    label: "Instructors" },
  { key: "classes",        label: "Classes" },
  { key: "schedules",      label: "Schedules" },
  { key: "packages",       label: "Packages" },
  { key: "bookings",       label: "Bookings" },
  { key: "students",       label: "Students" },
  { key: "offers",         label: "Offers" },
  { key: "hero_items",     label: "Hero Slides" },
  { key: "notifications",  label: "Notifications" },
  { key: "marketing",      label: "Marketing" },
  { key: "package_orders", label: "Package Orders" },
  { key: "attendance",     label: "Attendance" },
  { key: "system_users",   label: "System Users" },
] as const;

type ModuleKey = typeof MODULES[number]["key"];
type PermAction = "view" | "create" | "edit" | "delete";
const ACTIONS: { key: PermAction; label: string }[] = [
  { key: "view",   label: "View" },
  { key: "create", label: "Create" },
  { key: "edit",   label: "Edit" },
  { key: "delete", label: "Delete" },
];

type Permissions = Partial<Record<ModuleKey, Record<PermAction, boolean>>>;

function emptyPermissions(): Permissions {
  return {};
}

function getPermission(perms: Permissions, module: ModuleKey, action: PermAction): boolean {
  return perms[module]?.[action] ?? false;
}

function setPermission(perms: Permissions, module: ModuleKey, action: PermAction, value: boolean): Permissions {
  const updated = { ...perms };
  updated[module] = { view: false, create: false, edit: false, delete: false, ...updated[module], [action]: value };
  // If turning off view, turn off everything else for that module
  if (action === "view" && !value) {
    updated[module] = { view: false, create: false, edit: false, delete: false };
  }
  // If turning on create/edit/delete, auto-enable view
  if ((action === "create" || action === "edit" || action === "delete") && value) {
    updated[module] = { ...updated[module], view: true };
  }
  return updated;
}

function toggleAll(perms: Permissions, module: ModuleKey, enabled: boolean): Permissions {
  const updated = { ...perms };
  updated[module] = { view: enabled, create: enabled, edit: enabled, delete: enabled };
  return updated;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Permissions;
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

// ── Permission Matrix Component ───────────────────────────────────────────────

function PermissionMatrix({
  permissions,
  onChange,
}: {
  permissions: Permissions;
  onChange: (p: Permissions) => void;
}) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40 min-w-40">Module</TableHead>
            <TableHead className="text-center w-12">All</TableHead>
            {ACTIONS.map((a) => (
              <TableHead key={a.key} className="text-center">
                {a.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {MODULES.map((mod) => {
            const allEnabled = ACTIONS.every((a) => getPermission(permissions, mod.key, a.key));
            const anyEnabled = ACTIONS.some((a) => getPermission(permissions, mod.key, a.key));

            return (
              <TableRow key={mod.key}>
                <TableCell className="font-medium text-sm">
                  <span className={anyEnabled ? "text-foreground" : "text-muted-foreground"}>
                    {mod.label}
                  </span>
                </TableCell>
                {/* Toggle-all checkbox */}
                <TableCell className="text-center">
                  <Checkbox
                    checked={allEnabled}
                    onCheckedChange={(v) => onChange(toggleAll(permissions, mod.key, !!v))}
                  />
                </TableCell>
                {ACTIONS.map((action) => (
                  <TableCell key={action.key} className="text-center">
                    <Checkbox
                      checked={getPermission(permissions, mod.key, action.key)}
                      disabled={action.key !== "view" && !getPermission(permissions, mod.key, "view")}
                      onCheckedChange={(v) =>
                        onChange(setPermission(permissions, mod.key, action.key, !!v))
                      }
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Role Dialog (create / edit) ───────────────────────────────────────────────

function RoleDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: Role;
}) {
  const { token } = useAdminAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [permissions, setPermissions] = useState<Permissions>(existing?.permissions ?? emptyPermissions());
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!existing;

  const mutation = useMutation({
    mutationFn: async () => {
      const url = isEdit
        ? `${API_BASE}/api/admin/roles/${existing.id}`
        : `${API_BASE}/api/admin/roles`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: makeHeaders(token),
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, permissions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to save role");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
      toast({ title: isEdit ? "Role updated" : "Role created" });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Role — ${existing.name}` : "Create New Role"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Receptionist"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this role"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">
              Permissions
              <span className="text-muted-foreground font-normal text-xs ml-2">
                — "View" must be enabled before Create / Edit / Delete
              </span>
            </p>
            <PermissionMatrix permissions={permissions} onChange={setPermissions} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => { setError(null); mutation.mutate(); }}
            disabled={mutation.isPending || !name.trim()}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {isEdit ? "Save Changes" : "Create Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── User Dialogs ──────────────────────────────────────────────────────────────

function CreateUserDialog({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: Role[] }) {
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
        method: "POST", headers: makeHeaders(token), body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to create user");
      }
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
        <DialogHeader><DialogTitle>Create Admin User</DialogTitle></DialogHeader>
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
              <SelectTrigger><SelectValue placeholder="No role (no permissions)" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { setError(null); mutation.mutate(); }} disabled={mutation.isPending || !form.username || !form.password || !form.fullName || !form.email}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, open, onClose, roles }: { user: SystemUserRow; open: boolean; onClose: () => void; roles: Role[] }) {
  const { token, user: currentUser } = useAdminAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, email: user.email, roleId: user.roleId ? String(user.roleId) : "", isActive: user.isActive, password: "" });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { fullName: form.fullName.trim(), email: form.email.trim(), roleId: form.roleId ? parseInt(form.roleId) : null, isActive: form.isActive };
      if (form.password.trim()) body["password"] = form.password;
      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, { method: "PATCH", headers: makeHeaders(token), body: JSON.stringify(body) });
      if (!res.ok) { const data = await res.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "Failed to update user"); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-system-users"] }); toast({ title: "User updated" }); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  const isSelf = currentUser?.id === user.id;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit User — {user.username}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Full Name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          {!user.isSuperAdmin && (
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
                <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label>New Password <span className="text-xs text-muted-foreground">(leave blank to keep)</span></Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" /></div>
          {!isSelf && !user.isSuperAdmin && (
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label>{form.isActive ? "Account active" : "Account deactivated"}</Label>
            </div>
          )}
          {isSelf && <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />You cannot deactivate your own account.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { setError(null); mutation.mutate(); }} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({ roles }: { roles: Role[] }) {
  const usersQuery = useSystemUsers();
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<SystemUserRow | null>(null);

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowCreate(true)} style={{ background: "#8A5CFF", color: "#fff" }}>
          <Plus className="h-4 w-4 mr-1" /> New User
        </Button>
      </div>

      {usersQuery.isLoading && <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}
      {usersQuery.isError && <p className="text-destructive text-sm">Failed to load users.</p>}

      {usersQuery.data && (
        <div className="rounded-md border">
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
                      {u.isSuperAdmin && <Badge variant="secondary" className="ml-2 text-xs">Super Admin</Badge>}
                    </TableCell>
                    <TableCell>{u.fullName}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      {role
                        ? <Badge variant="outline">{role.name}</Badge>
                        : <span className="text-muted-foreground text-xs">No role</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? "default" : "outline"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => setEditTarget(u)}><Pencil className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog open={showCreate} onClose={() => setShowCreate(false)} roles={roles} />
      {editTarget && <EditUserDialog user={editTarget} open={true} onClose={() => setEditTarget(null)} roles={roles} />}
    </>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

function RolesTab({ roles, isLoading }: { roles: Role[]; isLoading: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowCreate(true)} style={{ background: "#8A5CFF", color: "#fff" }}>
          <Plus className="h-4 w-4 mr-1" /> New Role
        </Button>
      </div>

      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <ShieldCheck className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No roles yet. Create one to assign permissions to admin users.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => {
            const moduleCount = Object.keys(role.permissions).filter(
              (m) => Object.values(role.permissions[m as ModuleKey] ?? {}).some(Boolean)
            ).length;

            return (
              <div
                key={role.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div>
                  <p className="font-medium text-sm">{role.name}</p>
                  {role.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {MODULES.filter((m) =>
                      Object.values(role.permissions[m.key] ?? {}).some(Boolean)
                    ).map((m) => (
                      <Badge key={m.key} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {m.label}
                      </Badge>
                    ))}
                    {moduleCount === 0 && (
                      <span className="text-xs text-muted-foreground">No permissions assigned</span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditRole(role)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <RoleDialog open={showCreate} onClose={() => setShowCreate(false)} />
      {editRole && <RoleDialog open={true} onClose={() => setEditRole(null)} existing={editRole} />}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemUsersPage() {
  const { user: currentUser } = useAdminAuth();
  const rolesQuery = useRoles();
  const roles = rolesQuery.data ?? [];

  if (!currentUser?.isSuperAdmin) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center space-y-2">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Super Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="System Users & Roles"
        description="Manage admin accounts and define permission roles."
        mode="stage"
      />

      <Tabs defaultValue="users" className="mt-6">
        <TabsList className="mb-6">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersTab roles={roles} />
        </TabsContent>

        <TabsContent value="roles">
          <RolesTab roles={roles} isLoading={rolesQuery.isLoading} />
        </TabsContent>
      </Tabs>
    </>
  );
}
