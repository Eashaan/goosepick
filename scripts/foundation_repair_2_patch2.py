from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, got {count}: {pattern}")
    write(path, updated)


# -----------------------------------------------------------------------------
# useScopedCourts: ended sessions stay readable/exportable, but only draft/live
# sessions are mutable working sessions.
# -----------------------------------------------------------------------------
path = "src/hooks/useScopedCourts.tsx"
replace_once(
    path,
    '''  const workingSessionId =\n    activeSession && (activeSession.status === "draft" || activeSession.status === "live")\n      ? activeSession.id\n      : null;''',
    '''  const displaySessionId = activeSession?.id || null;\n  const workingSessionId =\n    activeSession && (activeSession.status === "draft" || activeSession.status === "live")\n      ? activeSession.id\n      : null;''',
)
replace_once(path, '''    queryKey: ["session_config", workingSessionId],''', '''    queryKey: ["session_config", displaySessionId],''')
replace_once(path, '''      if (!workingSessionId) return null;''', '''      if (!displaySessionId) return null;''')
replace_once(path, '''        .eq("session_id", workingSessionId)''', '''        .eq("session_id", displaySessionId)''')
replace_once(path, '''    queryKey: ["court_units", workingSessionId],''', '''    queryKey: ["court_units", displaySessionId],''')
replace_once(path, '''      if (!workingSessionId) return [];''', '''      if (!displaySessionId) return [];''')
replace_once(path, '''        .eq("session_id", workingSessionId)''', '''        .eq("session_id", displaySessionId)''')
replace_once(
    path,
    '''    enabled: isContextValid && !!workingSessionId && !!sessionConfig?.setup_completed,''',
    '''    enabled: isContextValid && !!displaySessionId && !!sessionConfig?.setup_completed,''',
)
replace_once(
    path,
    '''    workingSessionId,\n    scopeKey:''',
    '''    workingSessionId,\n    displaySessionId,\n    scopeKey:''',
)

# -----------------------------------------------------------------------------
# useActiveSession: ended runs are immutable. New Session creates a fresh draft.
# -----------------------------------------------------------------------------
path = "src/hooks/useActiveSession.tsx"
insert_marker = '''  const endSession = useMutation({'''
new_session_block = '''  const newSession = useMutation({\n    mutationFn: async () => {\n      const today = new Date().toISOString().split("T")[0];\n      const { data, error } = await supabase\n        .from("sessions" as any)\n        .insert({\n          city_id: selectedCityId,\n          event_type: scopeEventType,\n          location_id: selectedLocationId,\n          date: today,\n          is_active: false,\n          status: "draft",\n          session_label: null,\n        } as any)\n        .select("id")\n        .single();\n      if (error) throw error;\n      return (data as any).id as string;\n    },\n    onSuccess: (sessionId) => {\n      localStorage.setItem("gp_session_id", sessionId);\n      invalidateSession();\n      queryClient.invalidateQueries({ queryKey: ["session_config"] });\n      queryClient.invalidateQueries({ queryKey: ["court_units"] });\n      toast.success("New session created. Configure the courts for this run.");\n    },\n    onError: (err: Error) => {\n      toast.error(err.message);\n    },\n  });\n\n'''
replace_once(path, insert_marker, new_session_block + insert_marker)
replace_once(
    path,
    '''    endSession,\n    resetSession,''',
    '''    newSession,\n    endSession,\n    resetSession,''',
)

# -----------------------------------------------------------------------------
# Session lifecycle controls: ended session exposes Export + New Session, not Reset.
# -----------------------------------------------------------------------------
path = "src/components/admin/SessionLifecycleControls.tsx"
replace_once(
    path,
    '''    startSession,\n    endSession,''',
    '''    startSession,\n    newSession,\n    endSession,''',
)
replace_once(
    path,
    '''      {(!activeSession || isDraft || isEnded) && setupCompleted && (''',
    '''      {(!activeSession || isDraft) && setupCompleted && (''',
)
marker = '''      {/* End Session */}'''
new_button = '''      {isEnded && (\n        <Button\n          size="sm"\n          onClick={() => newSession.mutate()}\n          disabled={newSession.isPending}\n          className="gap-1.5 h-8 text-xs"\n        >\n          <Play className="h-3 w-3" />\n          New Session\n        </Button>\n      )}\n\n'''
replace_once(path, marker, new_button + marker)

# AdminDashboard: ended setup is read-only (no settings/edit setup).
path = "src/pages/admin/AdminDashboard.tsx"
replace_once(
    path,
    '''            {setupCompleted && !showEditSetup && (''',
    '''            {setupCompleted && !showEditSetup && !isEnded && (''',
)

# -----------------------------------------------------------------------------
# reset-session: use exact session config/units and delete session state rows.
# -----------------------------------------------------------------------------
path = "supabase/functions/reset-session/index.ts"
regex_once(
    path,
    r'''    // Find the singleton setup record for this city/event/location scope\..*?    assertNoError\("Session config lookup failed", configError\);''',
    '''    // Find the setup record owned by this exact session.\n    const { data: config, error: configError } = await supabase\n      .from("session_configs")\n      .select("id, session_id")\n      .eq("session_id", sessionId)\n      .maybeSingle();\n    assertNoError("Session config lookup failed", configError);''',
)
regex_once(
    path,
    r'''    // court_units are still a legacy scope-level setup table.*?    assertNoError\("Deleting court units failed", unitDeleteError\);''',
    '''    // Court units are owned by this session; never clear another run's setup.\n    const { error: unitDeleteError } = await supabase\n      .from("court_units")\n      .delete()\n      .eq("session_id", sessionId);\n    assertNoError("Deleting court units failed", unitDeleteError);''',
)
regex_once(
    path,
    r'''    // Clear transient state rows that are currently bound to this session\..*?    assertNoError\("Resetting court state failed", stateResetError\);''',
    '''    // Session-scoped court state is disposable setup/runtime state.\n    const { error: stateResetError } = await supabase\n      .from("court_state")\n      .delete()\n      .eq("session_id", sessionId);\n    assertNoError("Resetting court state failed", stateResetError);''',
)

# reset-ungrouped-court: court_unit lookup/unlock must match the same session.
path = "supabase/functions/reset-ungrouped-court/index.ts"
replace_once(
    path,
    '''      .eq("court_id", courtId)\n      .eq("city_id", cityId)''',
    '''      .eq("court_id", courtId)\n      .eq("session_id", sessionId)\n      .eq("city_id", cityId)''',
)
replace_once(
    path,
    '''        .eq("id", unitData.id)\n        .eq("city_id", cityId)''',
    '''        .eq("id", unitData.id)\n        .eq("session_id", sessionId)\n        .eq("city_id", cityId)''',
)

# reset-group: unlock the linked court_unit for this session too.
path = "supabase/functions/reset-group/index.ts"
marker = '''    assertNoError("Unlocking group failed", unlockError);\n\n    return new Response'''
replacement = '''    assertNoError("Unlocking group failed", unlockError);\n\n    const { error: unitUnlockError } = await supabase\n      .from("court_units")\n      .update({ is_locked: false })\n      .eq("session_id", sessionId)\n      .eq("court_group_id", groupId);\n    assertNoError("Unlocking group court unit failed", unitUnlockError);\n\n    return new Response'''
replace_once(path, marker, replacement)

# -----------------------------------------------------------------------------
# Feedback: bind submissions to session and keep duplicate submission idempotent.
# -----------------------------------------------------------------------------
path = "src/components/public/FeedbackModal.tsx"
replace_once(
    path,
    '''  playerId: string;\n  groupId?: string;''',
    '''  playerId: string;\n  sessionId: string;\n  groupId?: string;''',
)
replace_once(
    path,
    '''  playerId,\n  groupId,''',
    '''  playerId,\n  sessionId,\n  groupId,''',
)
replace_once(
    path,
    '''          player_id: playerId,\n          rating,''',
    '''          player_id: playerId,\n          session_id: sessionId,\n          rating,''',
)

path = "src/components/public/PersonalRoster.tsx"
replace_once(
    path,
    '''  const [showAutoStatsCard, setShowAutoStatsCard] = useState(false);\n\n  // Load saved player from localStorage''',
    '''  const [showAutoStatsCard, setShowAutoStatsCard] = useState(false);\n  const sessionKey = courtState?.session_id || matches.find(m => m.session_id)?.session_id || "no-session";\n  const storagePrefix = `gp_${sessionKey}_${groupId || `court-${courtId}`}`;\n\n  // Load saved player from localStorage''',
)
replace_once(path, '''localStorage.getItem(`gp_person_${courtId}`)''', '''localStorage.getItem(`${storagePrefix}_person`)''')
replace_once(path, '''  }, [courtId, players]);''', '''  }, [storagePrefix, players]);''')
replace_once(path, '''localStorage.setItem(`gp_person_${courtId}`, playerId);''', '''localStorage.setItem(`${storagePrefix}_person`, playerId);''')
replace_once(path, '''localStorage.getItem(`gp_feedback_${courtId}_${selectedPlayerId}`)''', '''localStorage.getItem(`${storagePrefix}_feedback_${selectedPlayerId}`)''')
replace_once(path, '''  }, [hasCompletedAllMatches, selectedPlayerId, courtId, feedbackSubmitted]);''', '''  }, [hasCompletedAllMatches, selectedPlayerId, storagePrefix, feedbackSubmitted]);''')
replace_once(path, '''const shownKey = `gp_rank_popup_${courtId}_${selectedPlayerId}`;''', '''const shownKey = `${storagePrefix}_rank_popup_${selectedPlayerId}`;''')
replace_once(path, '''  }, [hasCompletedAllMatches, selectedPlayerId, playerRank, courtId, showFeedback]);''', '''  }, [hasCompletedAllMatches, selectedPlayerId, playerRank, storagePrefix, showFeedback]);''')
replace_once(path, '''  }, [feedbackSubmitted, hasCompletedAllMatches, selectedPlayerId, playerRank, courtId, showFeedback]);''', '''  }, [feedbackSubmitted, hasCompletedAllMatches, selectedPlayerId, playerRank, storagePrefix, showFeedback]);''')
replace_once(path, '''const shownKey = `gp_podium_shown_${courtId}`;''', '''const shownKey = `${storagePrefix}_podium_shown`;''')
replace_once(path, '''  }, [selectedPlayerId, allPlayersHaveMatches, courtId, players.length]);''', '''  }, [selectedPlayerId, allPlayersHaveMatches, storagePrefix, players.length]);''')
replace_once(path, '''localStorage.setItem(`gp_rank_popup_${courtId}_${selectedPlayerId}`, "true");''', '''localStorage.setItem(`${storagePrefix}_rank_popup_${selectedPlayerId}`, "true");''')
replace_once(path, '''localStorage.setItem(`gp_podium_shown_${courtId}`, "true");''', '''localStorage.setItem(`${storagePrefix}_podium_shown`, "true");''')
replace_once(path, '''localStorage.removeItem(`gp_person_${courtId}`);''', '''localStorage.removeItem(`${storagePrefix}_person`);''')
replace_once(
    path,
    '''        playerId={selectedPlayerId}\n        groupId={groupId}''',
    '''        playerId={selectedPlayerId}\n        sessionId={sessionKey}\n        groupId={groupId}''',
)
replace_once(path, '''localStorage.setItem(`gp_feedback_${courtId}_${selectedPlayerId}`, "true");''', '''localStorage.setItem(`${storagePrefix}_feedback_${selectedPlayerId}`, "true");''')

path = "supabase/functions/submit-feedback/index.ts"
replace_once(
    path,
    '''    const { court_id, player_id, rating, note, group_id } = await req.json();''',
    '''    const { court_id, player_id, session_id, rating, note, group_id } = await req.json();''',
)
replace_once(
    path,
    '''    if (!court_id || !player_id || !rating) {''',
    '''    if (!court_id || !player_id || !session_id || !rating) {''',
)
replace_once(
    path,
    '''JSON.stringify({ ok: false, error: 'Missing required fields: court_id, player_id, rating' })''',
    '''JSON.stringify({ ok: false, error: 'Missing required fields: court_id, player_id, session_id, rating' })''',
)
replace_once(
    path,
    '''      .select('id, court_id, group_id')''',
    '''      .select('id, court_id, group_id, session_id')''',
)
replace_once(
    path,
    '''    // Validate player belongs to this court (ungrouped) or group containing this court\n    if (player.court_id === court_id) {''',
    '''    if (player.session_id !== session_id) {\n      return new Response(\n        JSON.stringify({ ok: false, error: 'Player does not belong to this session' }),\n        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }\n      );\n    }\n\n    // Validate player belongs to this court (ungrouped) or group containing this court\n    if (player.court_id === court_id) {''',
)
replace_once(
    path,
    '''        .select('court_ids')\n        .eq('id', group_id)\n        .single();''',
    '''        .select('court_ids, session_id')\n        .eq('id', group_id)\n        .eq('session_id', session_id)\n        .single();''',
)
replace_once(
    path,
    '''          court_id,\n          player_id,\n          rating,''',
    '''          court_id,\n          player_id,\n          session_id,\n          rating,''',
)
replace_once(
    path,
    '''          onConflict: 'court_id,player_id',''',
    '''          onConflict: 'session_id,court_id,player_id',''',
)

print("Foundation repair 2 follow-up patch applied successfully")
