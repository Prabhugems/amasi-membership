import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Verify the member session owns the resource at `memberId`.
 * Returns true if the member's email maps to that member row.
 */
export async function verifyMemberOwnership(
  supabase: SupabaseClient,
  memberSessionEmail: string,
  memberId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("members")
    .select("id")
    .eq("email", memberSessionEmail)
    .maybeSingle()
  if (error || !data) return false
  return data.id === memberId
}
