from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


# PublicGroup: remove the last Mumbai event-id assumption and never pass DB court
# primary keys as display court numbers.
path = "src/pages/public/PublicGroup.tsx"
replace_once(
    path,
    'import { useEventContext, GOOSEPICK_THURSDAYS_ID } from "@/hooks/useEventContext";',
    'import { useEventContext } from "@/hooks/useEventContext";',
)
replace_once(
    path,
    '''          courtIds={group.court_ids}\n        />''',
    '''          courtIds={groupCourtUnit?.group_court_numbers || group.court_ids.map((_: number, i: number) => i + 1)}\n        />''',
)
replace_once(
    path,
    '''              courtIds={group?.court_ids}\n            />''',
    '''              courtIds={groupCourtUnit?.group_court_numbers || group?.court_ids?.map((_: number, i: number) => i + 1)}\n            />''',
)
replace_once(
    path,
    '''    const nums = groupCourtUnit?.group_court_numbers || group?.court_ids;''',
    '''    const nums = groupCourtUnit?.group_court_numbers\n      || group?.court_ids?.map((_: number, i: number) => i + 1);''',
)
replace_once(
    path,
    '''  const isThursdays = selectedEvent?.id === GOOSEPICK_THURSDAYS_ID;''',
    '''  const isThursdays = selectedEvent?.event_type === "recurring";''',
)

# Feedback: group membership is canonical in group_physical_courts. Do not depend
# on the legacy overloaded court_groups.court_ids array.
path = "supabase/functions/submit-feedback/index.ts"
replace_once(
    path,
    '''      const { data: group, error: groupError } = await supabase\n        .from('court_groups')\n        .select('id, court_ids, session_id')\n        .eq('id', group_id)\n        .eq('session_id', session_id)\n        .single();\n\n      if (groupError || !group || !group.court_ids?.includes(court_id)) {\n        return new Response(\n          JSON.stringify({ ok: false, error: 'Player does not belong to this court' }),\n          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }\n        );\n      }\n      resolvedGroupId = group.id;''',
    '''      const { data: group, error: groupError } = await supabase\n        .from('court_groups')\n        .select('id, session_id')\n        .eq('id', group_id)\n        .eq('session_id', session_id)\n        .single();\n\n      if (groupError || !group) {\n        return new Response(\n          JSON.stringify({ ok: false, error: 'Player does not belong to this group' }),\n          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }\n        );\n      }\n\n      const { data: membership, error: membershipError } = await supabase\n        .from('group_physical_courts')\n        .select('id')\n        .eq('group_id', group_id)\n        .eq('session_id', session_id)\n        .eq('court_id', court_id)\n        .maybeSingle();\n\n      if (membershipError || !membership) {\n        return new Response(\n          JSON.stringify({ ok: false, error: 'Player does not belong to this court' }),\n          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }\n        );\n      }\n      resolvedGroupId = group.id;''',
)

print("Foundation hardening 3 follow-up patch applied")
