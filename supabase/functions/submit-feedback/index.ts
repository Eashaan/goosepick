import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { court_id, player_id, rating, note } = await req.json();

    // Validate required fields — return 200 with ok:false
    if (!court_id || !player_id || !rating) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields: court_id, player_id, rating' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate rating enum
    const validRatings = ['loved', 'good', 'okay'];
    if (!validRatings.includes(rating)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid rating. Must be: loved, good, or okay' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate note length (max 200 chars)
    if (note && typeof note === 'string' && note.length > 200) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Note must be 200 characters or less' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate court_id is a number
    if (typeof court_id !== 'number' || court_id < 1) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid court_id' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify player exists and belongs to this court
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, court_id')
      .eq('id', player_id)
      .single();

    if (playerError || !player) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Player not found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (player.court_id !== court_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Player does not belong to this court' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use upsert with onConflict to handle duplicates gracefully
    const { data: insertResult, error: insertError } = await supabase
      .from('feedback')
      .upsert(
        {
          court_id,
          player_id,
          rating,
          note: note?.trim() || null,
        },
        {
          onConflict: 'court_id,player_id',
          ignoreDuplicates: true,
        }
      )
      .select('id');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ ok: false, error: 'Failed to submit feedback' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const wasInserted = insertResult && insertResult.length > 0;

    return new Response(
      JSON.stringify({ 
        ok: true, 
        status: wasInserted ? 'submitted' : 'already_submitted' 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'Internal server error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
