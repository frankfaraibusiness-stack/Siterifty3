import { redirect } from "next/navigation";

// /profile was a stale placeholder route, separate from the real
// /myprofile page (see port-status.md) and from the public /seller/[id]
// page. Resolving it as a permanent redirect to the one real profile
// route rather than duplicating it — avoids two URLs serving the same
// content (bad for SEO) and means any old link/bookmark to /profile still
// lands somewhere useful instead of a dead placeholder.
export default function ProfilePage() {
  redirect("/myprofile");
}
