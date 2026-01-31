import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { court_id, player_id, rating, note } = await req.json();

    // Validate required fields
    if (!court_id || !player_id || !rating) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: court_id, player_id, rating' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate rating enum
    const validRatings = ['loved', 'good', 'okay'];
    if (!validRatings.includes(rating)) {
      return new Response(
        JSON.stringify({ error: 'Invalid rating. Must be: loved, good, or okay' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate note length (max 200 chars)
    if (note && typeof note === 'string' && note.length > 200) {
      return new Response(
        JSON.stringify({ error: 'Note must be 200 characters or less' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate court_id is a number
    if (typeof court_id !== 'number' || court_id < 1 || court_id > 7) {
      return new Response(
        JSON.stringify({ error: 'Invalid court_id. Must be between 1 and 7' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        JSON.stringify({ error: 'Player not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (player.court_id !== court_id) {
      return new Response(
        JSON.stringify({ error: 'Player does not belong to this court' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if feedback already exists for this player/court combo
    const { data: existing } = await supabase
      .from('feedback')
      .select('id')
      .eq('player_id', player_id)
      .eq('court_id', court_id)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ error: 'Feedback already submitted for this player on this court' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert feedback using service role
    const { error: insertError } = await supabase.from('feedback').insert({
      court_id,
      player_id,
      rating,
      note: note?.trim() || null,
    });

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to submit feedback' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
