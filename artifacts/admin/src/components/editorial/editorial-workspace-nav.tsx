import { WorkspaceRouteNav } from "@/components/admin/workspace-route-nav";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

/**
 * Route-preserving local navigation for the Website Editorial workspace.
 * Each item keeps its existing permission; Compatibility is deliberately
 * positioned last because it is supporting legacy News maintenance.
 */
export function EditorialWorkspaceNav() {
  const { can } = useAdminAuth();

  return (
    <WorkspaceRouteNav
      ariaLabel="Editorial workspace"
      items={[
        ...(can("website.posts", "view") ? [{ label: "Posts", href: "/editorial/posts" }] : []),
        ...(can("website.posts", "view") ? [{ label: "Authors", href: "/editorial/authors" }] : []),
        ...(can("website.posts", "view") ? [{ label: "Topics", href: "/editorial/topics" }] : []),
        ...(can("website.posts", "view") ? [{ label: "Placements", href: "/editorial/placements" }] : []),
        ...(can("website.news", "view") ? [{ label: "Compatibility", href: "/website/news" }] : []),
      ]}
    />
  );
}
