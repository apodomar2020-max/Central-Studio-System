/**
 * System Users & Roles page.
 * Tab 1 — Users: create/edit admin accounts, assign roles.
 * Tab 2 — Roles: visual permission matrix builder per module.
 *
 * Access is delegated, not Super-Admin-only: the route (App.tsx ROUTE_PERMS.systemUsers)
 * and the sidebar (nav-config.ts) already require adminUsers.view or roles.view (any one),
 * matching every other page's pattern. This page mirrors that:
 *  - The Users tab renders for adminUsers.view (or Super Admin).
 *  - The Roles tab renders for roles.view (or Super Admin).
 *  - Every mutation control (New User, Edit fields, role assignment, active toggle,
 *    New Role, Edit Role details, permission matrix editing) is additionally scoped
 *    to its own exact backend-enforced permission — see the per-control checks below.
 *  - GET /api/admin/roles itself requires roles.view on the backend, so the roles
 *    list is only ever fetched when the current admin can actually read it; an
 *    adminUsers.view-only admin gets a working Users tab without role names.
 *  - This is presentation-only, same as every other page (see lib/permissions.tsx):
 *    the backend still independently enforces every one of these permissions.
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
import { Loader2, Pencil, ShieldCheck, AlertTriangle, Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AccessDenied } from "@/components/access-denied";
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  countCatalogPermissions,
  hasRolePermission,
  normalizeRolePermissions,
  type PermissionMap,
  type PermissionModuleDefinition,
} from "@workspace/api-zod";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ── Permission helpers ────────────────────────────────────────────────────────

function setPermission(
  permissions: PermissionMap,
  moduleKey: string,
  actionKey: string,
  enabled: boolean,
): PermissionMap {
  return {
    ...permissions,
    [moduleKey]: {
      ...(permissions[moduleKey] ?? {}),
      [actionKey]: enabled,
    },
  };
}

function toggleModule(
  permissions: PermissionMap,
  module: PermissionModuleDefinition,
  enabled: boolean,
): PermissionMap {
  return {
    ...permissions,
    [module.key]: {
      ...(permissions[module.key] ?? {}),
      ...Object.fromEntries(module.actions.map((action) => [action.key, enabled])),
    },
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: PermissionMap;
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

function useRoles(enabled = true) {
  const { token } = useAdminAuth();
  return useQuery<Role[]>({
    queryKey: ["admin-roles"],
    enabled,
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
  disabled = false,
}: {
  permissions: PermissionMap;
  onChange: (p: PermissionMap) => void;
  /** Read-only mode — the current admin holds roles.view but not roles.assignPermissions. */
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const enabledCount = countCatalogPermissions(permissions);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search permissions"
            className="pl-9"
          />
        </div>
        <Badge variant="secondary" className="w-fit">
          {enabledCount} enabled
        </Badge>
      </div>

      {PERMISSION_GROUPS.map((group) => {
        const modules = PERMISSION_CATALOG.filter((module) => {
          if (module.group !== group) return false;
          if (!query) return true;
          return `${module.label} ${module.description} ${module.actions.map((action) => action.label).join(" ")}`
            .toLowerCase()
            .includes(query);
        });
        if (modules.length === 0) return null;

        return (
          <section key={group} className="overflow-hidden rounded-md border">
            <div className="border-b bg-muted/40 px-4 py-2.5">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">{group}</h3>
            </div>
            <div className="divide-y">
              {modules.map((module) => {
                const enabledActions = module.actions.filter((action) =>
                  hasRolePermission(permissions, module.key, action.key),
                ).length;
                const allEnabled = enabledActions === module.actions.length;

                return (
                  <div key={module.key} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.6fr)]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{module.label}</p>
                        {module.reserved && <Badge variant="outline" className="text-[10px]">Reserved</Badge>}
                        {!module.reserved && enabledActions > 0 && (
                          <span className="text-[10px] text-muted-foreground">{enabledActions}/{module.actions.length}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{module.description}</p>
                      <div className="mt-2 flex gap-3 text-[11px]">
                        <button
                          type="button"
                          disabled={disabled || module.reserved || allEnabled}
                          onClick={() => onChange(toggleModule(permissions, module, true))}
                          className="text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          disabled={disabled || module.reserved || enabledActions === 0}
                          onClick={() => onChange(toggleModule(permissions, module, false))}
                          className="text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap content-start gap-2">
                      {module.actions.map((action) => {
                        const checked = hasRolePermission(permissions, module.key, action.key);
                        return (
                          <label
                            key={action.key}
                            className={`flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                              disabled || module.reserved ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/40"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={disabled || module.reserved}
                              onCheckedChange={(value) =>
                                onChange(setPermission(permissions, module.key, action.key, !!value))
                              }
                            />
                            {action.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {query && !PERMISSION_CATALOG.some((module) =>
        `${module.label} ${module.description} ${module.actions.map((action) => action.label).join(" ")}`
          .toLowerCase()
          .includes(query),
      ) && (
        <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No permissions match “{search}”.
        </div>
      )}
    </div>
  );
}

// ── Role Dialog (create / edit) ───────────────────────────────────────────────

function RoleDialog({
  open,
  onClose,
  existing,
  canEditDetails,
  canAssignPermissions,
}: {
  open: boolean;
  onClose: () => void;
  existing?: Role;
  /** roles.edit (create mode is always editable — roles.create already gated opening this dialog). */
  canEditDetails: boolean;
  /** roles.assignPermissions — governs the permission matrix, not name/description. */
  canAssignPermissions: boolean;
}) {
  const { token } = useAdminAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [permissions, setPermissions] = useState<PermissionMap>(() =>
    normalizeRolePermissions(existing?.permissions),
  );
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!existing;

  const mutation = useMutation({
    mutationFn: async () => {
      const url = isEdit
        ? `${API_BASE}/api/admin/roles/${existing.id}`
        : `${API_BASE}/api/admin/roles`;
      const body: Record<string, unknown> = {};
      if (canEditDetails) {
        body["name"] = name.trim();
        body["description"] = description.trim() || null;
      }
      // Omit the "permissions" key entirely when the admin can't assign
      // permissions — PATCH/POST /admin/roles requires roles.assignPermissions
      // as soon as the body contains a "permissions" key at all, regardless
      // of whether the value actually changed.
      if (canAssignPermissions) body["permissions"] = permissions;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: makeHeaders(token),
        body: JSON.stringify(body),
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

  const nothingEditable = !canEditDetails && !canAssignPermissions;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Role — ${existing.name}` : "Create New Role"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role Name</Label>
              <Input
                value={name}
                disabled={!canEditDetails}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Receptionist"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={description}
                disabled={!canEditDetails}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this role"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">
              Permissions
              <span className="text-muted-foreground font-normal text-xs ml-2">
                — {countCatalogPermissions(permissions)} actions enabled
              </span>
            </p>
            {!canAssignPermissions && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                <AlertTriangle className="h-3 w-3" />
                You have view-only access to this role&apos;s permissions.
              </p>
            )}
            <PermissionMatrix permissions={permissions} onChange={setPermissions} disabled={!canAssignPermissions} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => { setError(null); mutation.mutate(); }}
            disabled={mutation.isPending || !name.trim() || nothingEditable}
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

function CreateUserDialog({
  open,
  onClose,
  roles,
  canAssignRole,
}: {
  open: boolean;
  onClose: () => void;
  roles: Role[];
  /** adminUsers.assignRole (and roles.view, so the picker has data to show). */
  canAssignRole: boolean;
}) {
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
        // Only ever sent when the picker was actually usable — POST /admin/users
        // requires adminUsers.assignRole whenever roleId is present in the body.
        ...(canAssignRole && form.roleId ? { roleId: parseInt(form.roleId) } : {}),
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          {canAssignRole ? (
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
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              You don&apos;t have permission to assign a role — this user will be created with no role.
            </p>
          )}
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

function EditUserDialog({
  user,
  open,
  onClose,
  roles,
  canEditFields,
  canAssignRole,
  canDisable,
}: {
  user: SystemUserRow;
  open: boolean;
  onClose: () => void;
  roles: Role[];
  /** adminUsers.edit — full name, email, password. */
  canEditFields: boolean;
  /** adminUsers.assignRole (and roles.view, so the picker has data to show). */
  canAssignRole: boolean;
  /** adminUsers.disable — the active/inactive toggle. */
  canDisable: boolean;
}) {
  const { token, user: currentUser } = useAdminAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, email: user.email, roleId: user.roleId ? String(user.roleId) : "", isActive: user.isActive, password: "" });
  const [error, setError] = useState<string | null>(null);

  const isSelf = currentUser?.id === user.id;
  const isSuperAdmin = currentUser?.isSuperAdmin === true;
  // Only a Super Admin may touch another Super Admin's account at all
  // (backend: "Super Admin accounts can only be modified by another Super Admin").
  const canModifyTarget = isSuperAdmin || !user.isSuperAdmin;
  const fieldsEditable = canModifyTarget && (isSuperAdmin || canEditFields);
  // `canAssignRole` (passed down from UsersTab) already folds in roles.view —
  // there'd be nothing to pick from otherwise.
  const roleEditable = canModifyTarget && !user.isSuperAdmin && (isSuperAdmin || canAssignRole);
  const activeToggleable = canModifyTarget && !isSelf && !user.isSuperAdmin && (isSuperAdmin || canDisable);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (fieldsEditable) {
        body["fullName"] = form.fullName.trim();
        body["email"] = form.email.trim();
        if (form.password.trim()) body["password"] = form.password;
      }
      if (roleEditable) body["roleId"] = form.roleId ? parseInt(form.roleId) : null;
      if (activeToggleable) body["isActive"] = form.isActive;
      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, { method: "PATCH", headers: makeHeaders(token), body: JSON.stringify(body) });
      if (!res.ok) { const data = await res.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "Failed to update user"); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-system-users"] }); toast({ title: "User updated" }); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  const nothingEditable = !fieldsEditable && !roleEditable && !activeToggleable;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit User — {user.username}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Full Name</Label><Input value={form.fullName} disabled={!fieldsEditable} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} disabled={!fieldsEditable} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          {roleEditable && (
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
          <div className="space-y-1.5"><Label>New Password <span className="text-xs text-muted-foreground">(leave blank to keep)</span></Label><Input type="password" value={form.password} disabled={!fieldsEditable} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" /></div>
          {activeToggleable && (
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label>{form.isActive ? "Account active" : "Account deactivated"}</Label>
            </div>
          )}
          {isSelf && <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />You cannot deactivate or re-role your own account.</p>}
          {!canModifyTarget && <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Only another Super Admin can modify a Super Admin account.</p>}
          {nothingEditable && !isSelf && canModifyTarget && (
            <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />You have view-only access to admin users.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { setError(null); mutation.mutate(); }} disabled={mutation.isPending || nothingEditable}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({ roles, canViewRoles }: { roles: Role[]; canViewRoles: boolean }) {
  const { can, user: currentUser } = useAdminAuth();
  const isSuperAdmin = currentUser?.isSuperAdmin === true;
  const canCreate = isSuperAdmin || can("adminUsers", "create");
  const canEditFields = isSuperAdmin || can("adminUsers", "edit");
  const canAssignRole = (isSuperAdmin || can("adminUsers", "assignRole")) && canViewRoles;
  const canDisable = isSuperAdmin || can("adminUsers", "disable");
  // A row's Edit button is only worth showing if at least one mutation is
  // possible for it — a pure view-only admin sees the table with no actions.
  const canEditAnything = canEditFields || canAssignRole || canDisable;

  const usersQuery = useSystemUsers();
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<SystemUserRow | null>(null);

  return (
    <div className="admin2-final-page admin2-system-access">
      {canCreate && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New User
          </Button>
        </div>
      )}

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
                {canEditAnything && <TableHead className="w-10" />}
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
                      {role ? (
                        <Badge variant="outline">{role.name}</Badge>
                      ) : u.roleId != null && !canViewRoles ? (
                        // Backend GET /admin/roles requires roles.view — this admin
                        // can see that a role is assigned without seeing its name.
                        <span className="text-muted-foreground text-xs">Role assigned</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">No role</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? "default" : "outline"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    {canEditAnything && (
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setEditTarget(u)}><Pencil className="h-4 w-4" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canCreate && <CreateUserDialog open={showCreate} onClose={() => setShowCreate(false)} roles={roles} canAssignRole={canAssignRole} />}
      {editTarget && canEditAnything && (
        <EditUserDialog
          user={editTarget}
          open={true}
          onClose={() => setEditTarget(null)}
          roles={roles}
          canEditFields={canEditFields}
          canAssignRole={canAssignRole}
          canDisable={canDisable}
        />
      )}
    </div>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

function RolesTab({ roles, isLoading }: { roles: Role[]; isLoading: boolean }) {
  const { can, user: currentUser } = useAdminAuth();
  const isSuperAdmin = currentUser?.isSuperAdmin === true;
  const canCreate = isSuperAdmin || can("roles", "create");
  const canEditDetails = isSuperAdmin || can("roles", "edit");
  const canAssignPermissions = isSuperAdmin || can("roles", "assignPermissions");
  // A role's Edit button is only worth showing if at least one mutation is
  // possible for it — a pure roles.view admin sees the list with no actions.
  const canEditAnyRole = canEditDetails || canAssignPermissions;

  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <>
      {canCreate && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Role
          </Button>
        </div>
      )}

      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <ShieldCheck className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No roles yet. Create one to assign permissions to admin users.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => {
            const enabledModules = PERMISSION_CATALOG.filter((module) =>
              module.actions.some((action) => hasRolePermission(role.permissions, module.key, action.key)),
            );

            return (
              <div
                key={role.id}
                className="flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm">{role.name}</p>
                  {role.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {enabledModules.map((m) => (
                      <Badge key={m.key} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {m.label}
                      </Badge>
                    ))}
                    {enabledModules.length === 0 && (
                      <span className="text-xs text-muted-foreground">No permissions assigned</span>
                    )}
                  </div>
                </div>
                {canEditAnyRole && (
                  <Button size="sm" variant="outline" className="self-start shrink-0 sm:self-auto" onClick={() => setEditRole(role)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canCreate && (
        <RoleDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          canEditDetails
          canAssignPermissions={canAssignPermissions}
        />
      )}
      {editRole && canEditAnyRole && (
        <RoleDialog
          open={true}
          onClose={() => setEditRole(null)}
          existing={editRole}
          canEditDetails={canEditDetails}
          canAssignPermissions={canAssignPermissions}
        />
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemUsersPage() {
  const { user: currentUser, can } = useAdminAuth();
  const isSuperAdmin = currentUser?.isSuperAdmin === true;
  const canViewUsers = isSuperAdmin || can("adminUsers", "view");
  const canViewRoles = isSuperAdmin || can("roles", "view");

  // GET /api/admin/roles requires roles.view on the backend (or Super Admin) —
  // fetch it only when the current admin can actually read it. An
  // adminUsers.view-only admin gets a fully working Users tab without ever
  // calling an endpoint that would 403 for them.
  const rolesQuery = useRoles(canViewRoles);
  const roles = rolesQuery.data ?? [];

  // Defensive fallback only: App.tsx's RouteGuard (ROUTE_PERMS.systemUsers)
  // already requires adminUsers.view or roles.view before this component is
  // ever mounted, so this branch should be unreachable in practice. Kept
  // consistent with every other page's Access Denied treatment rather than
  // a bespoke message.
  if (!canViewUsers && !canViewRoles) {
    return <AccessDenied message="You do not have permission to manage System Users or Roles." />;
  }

  const defaultTab = canViewUsers ? "users" : "roles";

  return (
    <div className="admin2-system-access">
      <PageHeader
        title="System Users & Roles"
        description="Manage admin accounts and define permission roles."
        mode="stage"
      />

      {canViewRoles && rolesQuery.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Roles could not be loaded. Permission editing remains unavailable until the data is restored.
        </div>
      )}

      <Tabs defaultValue={defaultTab} className="mt-6">
        <TabsList className="mb-6">
          {canViewUsers && <TabsTrigger value="users">Users</TabsTrigger>}
          {canViewRoles && <TabsTrigger value="roles">Roles</TabsTrigger>}
        </TabsList>

        {canViewUsers && (
          <TabsContent value="users">
            <UsersTab roles={roles} canViewRoles={canViewRoles} />
          </TabsContent>
        )}

        {canViewRoles && (
          <TabsContent value="roles">
            <RolesTab roles={roles} isLoading={rolesQuery.isLoading} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
import "./admin2-final.css";
