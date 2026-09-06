export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cities: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      commerce_orders: {
        Row: {
          created_at: string
          currency: string | null
          financial_status: string | null
          id: string
          processed_at: string | null
          purchaser_email: string | null
          purchaser_phone: string | null
          purchaser_profile_id: string | null
          raw_payload: Json | null
          shopify_order_id: string
          shopify_order_name: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          financial_status?: string | null
          id?: string
          processed_at?: string | null
          purchaser_email?: string | null
          purchaser_phone?: string | null
          purchaser_profile_id?: string | null
          raw_payload?: Json | null
          shopify_order_id: string
          shopify_order_name?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          financial_status?: string | null
          id?: string
          processed_at?: string | null
          purchaser_email?: string | null
          purchaser_phone?: string | null
          purchaser_profile_id?: string | null
          raw_payload?: Json | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commerce_orders_purchaser_profile_id_fkey"
            columns: ["purchaser_profile_id"]
            isOneToOne: false
            referencedRelation: "participant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      court_groups: {
        Row: {
          court_ids: number[]
          created_at: string
          duration_hours: number | null
          format_type: Database["public"]["Enums"]["format_type"]
          id: string
          is_locked: boolean
          locked_at: string | null
          matches_per_hour: number | null
          session_config_id: string
          session_id: string | null
          total_matches: number | null
        }
        Insert: {
          court_ids: number[]
          created_at?: string
          duration_hours?: number | null
          format_type?: Database["public"]["Enums"]["format_type"]
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          matches_per_hour?: number | null
          session_config_id: string
          session_id?: string | null
          total_matches?: number | null
        }
        Update: {
          court_ids?: number[]
          created_at?: string
          duration_hours?: number | null
          format_type?: Database["public"]["Enums"]["format_type"]
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          matches_per_hour?: number | null
          session_config_id?: string
          session_id?: string | null
          total_matches?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "court_groups_session_config_id_fkey"
            columns: ["session_config_id"]
            isOneToOne: false
            referencedRelation: "session_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_groups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_state: {
        Row: {
          court_id: number
          current_match_index: number
          id: string
          phase: Database["public"]["Enums"]["court_phase"]
          session_id: string | null
          updated_at: string
        }
        Insert: {
          court_id: number
          current_match_index?: number
          id?: string
          phase?: Database["public"]["Enums"]["court_phase"]
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          court_id?: number
          current_match_index?: number
          id?: string
          phase?: Database["public"]["Enums"]["court_phase"]
          session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_state_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_state_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_units: {
        Row: {
          city_id: string
          court_group_id: string | null
          court_id: number | null
          court_number: number | null
          created_at: string
          display_name: string
          event_type: Database["public"]["Enums"]["scope_event_type"]
          format_type: Database["public"]["Enums"]["format_type"]
          group_court_numbers: number[] | null
          id: string
          is_locked: boolean
          location_id: string | null
          session_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          city_id: string
          court_group_id?: string | null
          court_id?: number | null
          court_number?: number | null
          created_at?: string
          display_name: string
          event_type: Database["public"]["Enums"]["scope_event_type"]
          format_type?: Database["public"]["Enums"]["format_type"]
          group_court_numbers?: number[] | null
          id?: string
          is_locked?: boolean
          location_id?: string | null
          session_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          city_id?: string
          court_group_id?: string | null
          court_id?: number | null
          court_number?: number | null
          created_at?: string
          display_name?: string
          event_type?: Database["public"]["Enums"]["scope_event_type"]
          format_type?: Database["public"]["Enums"]["format_type"]
          group_court_numbers?: number[] | null
          id?: string
          is_locked?: boolean
          location_id?: string | null
          session_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_units_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_units_court_group_id_fkey"
            columns: ["court_group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_units_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_units_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_units_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          event_id: string | null
          format_type: Database["public"]["Enums"]["format_type"]
          id: number
          location_id: string | null
          name: string
          session_id: string | null
        }
        Insert: {
          event_id?: string | null
          format_type?: Database["public"]["Enums"]["format_type"]
          id?: number
          location_id?: string | null
          name: string
          session_id?: string | null
        }
        Update: {
          event_id?: string | null
          format_type?: Database["public"]["Enums"]["format_type"]
          id?: number
          location_id?: string | null
          name?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          active: boolean
          city_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          city_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          city_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      experience_registrations: {
        Row: {
          cancelled_at: string | null
          claim_token_hash: string | null
          commerce_order_id: string | null
          created_at: string
          id: string
          mapping_id: string | null
          participant_email: string | null
          participant_name: string | null
          participant_phone: string | null
          profile_id: string | null
          purchaser_profile_id: string | null
          refunded_at: string | null
          seat_index: number
          session_id: string | null
          shopify_line_item_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          claim_token_hash?: string | null
          commerce_order_id?: string | null
          created_at?: string
          id?: string
          mapping_id?: string | null
          participant_email?: string | null
          participant_name?: string | null
          participant_phone?: string | null
          profile_id?: string | null
          purchaser_profile_id?: string | null
          refunded_at?: string | null
          seat_index: number
          session_id?: string | null
          shopify_line_item_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          claim_token_hash?: string | null
          commerce_order_id?: string | null
          created_at?: string
          id?: string
          mapping_id?: string | null
          participant_email?: string | null
          participant_name?: string | null
          participant_phone?: string | null
          profile_id?: string | null
          purchaser_profile_id?: string | null
          refunded_at?: string | null
          seat_index?: number
          session_id?: string | null
          shopify_line_item_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experience_registrations_commerce_order_id_fkey"
            columns: ["commerce_order_id"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experience_registrations_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: false
            referencedRelation: "shopify_session_mappings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experience_registrations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "participant_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experience_registrations_purchaser_profile_id_fkey"
            columns: ["purchaser_profile_id"]
            isOneToOne: false
            referencedRelation: "participant_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experience_registrations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          court_id: number
          created_at: string
          group_id: string | null
          id: string
          note: string | null
          player_id: string
          rating: Database["public"]["Enums"]["feedback_rating"]
          session_id: string | null
        }
        Insert: {
          court_id: number
          created_at?: string
          group_id?: string | null
          id?: string
          note?: string | null
          player_id: string
          rating: Database["public"]["Enums"]["feedback_rating"]
          session_id?: string | null
        }
        Update: {
          court_id?: number
          created_at?: string
          group_id?: string | null
          id?: string
          note?: string | null
          player_id?: string
          rating?: Database["public"]["Enums"]["feedback_rating"]
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_court_state: {
        Row: {
          court_number: number
          current_match_global_index: number | null
          current_match_id: string | null
          group_id: string
          id: string
          is_live: boolean
          session_id: string | null
          updated_at: string
        }
        Insert: {
          court_number: number
          current_match_global_index?: number | null
          current_match_id?: string | null
          group_id: string
          id?: string
          is_live?: boolean
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          court_number?: number
          current_match_global_index?: number | null
          current_match_id?: string | null
          group_id?: string
          id?: string
          is_live?: boolean
          session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_court_state_current_match_id_fkey"
            columns: ["current_match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_court_state_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_court_state_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_physical_courts: {
        Row: {
          court_id: number
          court_number: number
          created_at: string
          group_id: string
          id: string
          session_id: string | null
        }
        Insert: {
          court_id: number
          court_number: number
          created_at?: string
          group_id: string
          id?: string
          session_id?: string | null
        }
        Update: {
          court_id?: number
          court_number?: number
          created_at?: string
          group_id?: string
          id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_physical_courts_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_physical_courts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_physical_courts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          active: boolean
          city_id: string | null
          created_at: string
          event_id: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          city_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          city_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_substitutions: {
        Row: {
          court_id: number
          created_at: string
          global_match_index: number | null
          group_id: string | null
          id: string
          match_id: string
          reason: string | null
          replaced_player_id: string
          session_id: string | null
          slot: string | null
          substitute_player_id: string
        }
        Insert: {
          court_id: number
          created_at?: string
          global_match_index?: number | null
          group_id?: string | null
          id?: string
          match_id: string
          reason?: string | null
          replaced_player_id: string
          session_id?: string | null
          slot?: string | null
          substitute_player_id: string
        }
        Update: {
          court_id?: number
          created_at?: string
          global_match_index?: number | null
          group_id?: string | null
          id?: string
          match_id?: string
          reason?: string | null
          replaced_player_id?: string
          session_id?: string | null
          slot?: string | null
          substitute_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_substitutions_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_substitutions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_substitutions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_substitutions_replaced_player_id_fkey"
            columns: ["replaced_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_substitutions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_substitutions_substitute_player_id_fkey"
            columns: ["substitute_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          completed_at: string | null
          court_id: number
          court_number: number | null
          created_at: string
          global_match_index: number | null
          group_id: string | null
          id: string
          match_index: number
          override_played: boolean
          session_id: string | null
          started_at: string | null
          status: string
          team1_player1_id: string | null
          team1_player2_id: string | null
          team1_score: number | null
          team2_player1_id: string | null
          team2_player2_id: string | null
          team2_score: number | null
        }
        Insert: {
          completed_at?: string | null
          court_id: number
          court_number?: number | null
          created_at?: string
          global_match_index?: number | null
          group_id?: string | null
          id?: string
          match_index: number
          override_played?: boolean
          session_id?: string | null
          started_at?: string | null
          status?: string
          team1_player1_id?: string | null
          team1_player2_id?: string | null
          team1_score?: number | null
          team2_player1_id?: string | null
          team2_player2_id?: string | null
          team2_score?: number | null
        }
        Update: {
          completed_at?: string | null
          court_id?: number
          court_number?: number | null
          created_at?: string
          global_match_index?: number | null
          group_id?: string | null
          id?: string
          match_index?: number
          override_played?: boolean
          session_id?: string | null
          started_at?: string | null
          status?: string
          team1_player1_id?: string | null
          team1_player2_id?: string | null
          team1_score?: number | null
          team2_player1_id?: string | null
          team2_player2_id?: string | null
          team2_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team1_player1_id_fkey"
            columns: ["team1_player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team1_player2_id_fkey"
            columns: ["team1_player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team2_player1_id_fkey"
            columns: ["team2_player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team2_player2_id_fkey"
            columns: ["team2_player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_profiles: {
        Row: {
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          marketing_opt_in: boolean
          phone: string | null
          preferred_city_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          phone?: string | null
          preferred_city_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          phone?: string | null
          preferred_city_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_profiles_preferred_city_id_fkey"
            columns: ["preferred_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          added_by_admin: boolean
          court_id: number | null
          created_at: string
          group_id: string | null
          id: string
          is_guest: boolean
          name: string
          profile_id: string | null
          registration_id: string | null
          session_id: string | null
        }
        Insert: {
          added_by_admin?: boolean
          court_id?: number | null
          created_at?: string
          group_id?: string | null
          id?: string
          is_guest?: boolean
          name: string
          profile_id?: string | null
          registration_id?: string | null
          session_id?: string | null
        }
        Update: {
          added_by_admin?: boolean
          court_id?: number | null
          created_at?: string
          group_id?: string | null
          id?: string
          is_guest?: boolean
          name?: string
          profile_id?: string | null
          registration_id?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "court_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "participant_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "experience_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rotation_audit: {
        Row: {
          court_id: number
          created_at: string
          fairness_score: number
          id: string
          matches_per_player_max: number
          matches_per_player_min: number
          max_consecutive_sitouts: number
          repeat_opponent_count: number
          repeat_partner_count: number
          session_id: string | null
          total_players: number
        }
        Insert: {
          court_id: number
          created_at?: string
          fairness_score?: number
          id?: string
          matches_per_player_max: number
          matches_per_player_min: number
          max_consecutive_sitouts: number
          repeat_opponent_count?: number
          repeat_partner_count?: number
          session_id?: string | null
          total_players: number
        }
        Update: {
          court_id?: number
          created_at?: string
          fairness_score?: number
          id?: string
          matches_per_player_max?: number
          matches_per_player_min?: number
          max_consecutive_sitouts?: number
          repeat_opponent_count?: number
          repeat_partner_count?: number
          session_id?: string | null
          total_players?: number
        }
        Relationships: [
          {
            foreignKeyName: "rotation_audit_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_configs: {
        Row: {
          city_id: string
          court_count: number
          created_at: string
          event_id: string
          event_type: Database["public"]["Enums"]["scope_event_type"]
          id: string
          location_id: string | null
          session_id: string | null
          setup_completed: boolean
          updated_at: string | null
        }
        Insert: {
          city_id: string
          court_count: number
          created_at?: string
          event_id: string
          event_type: Database["public"]["Enums"]["scope_event_type"]
          id?: string
          location_id?: string | null
          session_id?: string | null
          setup_completed?: boolean
          updated_at?: string | null
        }
        Update: {
          city_id?: string
          court_count?: number
          created_at?: string
          event_id?: string
          event_type?: Database["public"]["Enums"]["scope_event_type"]
          id?: string
          location_id?: string | null
          session_id?: string | null
          setup_completed?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_configs_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_configs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_configs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_configs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          city_id: string
          created_at: string
          date: string
          ended_at: string | null
          event_type: Database["public"]["Enums"]["scope_event_type"]
          id: string
          is_active: boolean
          location_id: string | null
          session_label: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["session_status"]
        }
        Insert: {
          city_id: string
          created_at?: string
          date?: string
          ended_at?: string | null
          event_type: Database["public"]["Enums"]["scope_event_type"]
          id?: string
          is_active?: boolean
          location_id?: string | null
          session_label?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
        }
        Update: {
          city_id?: string
          created_at?: string
          date?: string
          ended_at?: string | null
          event_type?: Database["public"]["Enums"]["scope_event_type"]
          id?: string
          is_active?: boolean
          location_id?: string | null
          session_label?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sessions_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_session_mappings: {
        Row: {
          city_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["scope_event_type"]
          id: string
          is_active: boolean
          location_id: string | null
          mapping_key: string
          metadata: Json
          session_date: string
          session_id: string | null
          shopify_product_id: string
          shopify_variant_id: string | null
          updated_at: string
        }
        Insert: {
          city_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["scope_event_type"]
          id?: string
          is_active?: boolean
          location_id?: string | null
          mapping_key: string
          metadata?: Json
          session_date: string
          session_id?: string | null
          shopify_product_id: string
          shopify_variant_id?: string | null
          updated_at?: string
        }
        Update: {
          city_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["scope_event_type"]
          id?: string
          is_active?: boolean
          location_id?: string | null
          mapping_key?: string
          metadata?: Json
          session_date?: string
          session_id?: string | null
          shopify_product_id?: string
          shopify_variant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_session_mappings_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_session_mappings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_session_mappings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_registration_to_roster: {
        Args: {
          p_court_id?: number
          p_group_id?: string
          p_name?: string
          p_registration_id: string
          p_session_id: string
        }
        Returns: Json
      }
      current_participant_profile_id: { Args: never; Returns: string }
      end_group_match_atomic: {
        Args: {
          p_court_number: number
          p_group_id: string
          p_match_id: string
          p_session_id: string
          p_team1_score: number
          p_team2_score: number
        }
        Returns: Json
      }
      end_match_atomic: {
        Args: {
          p_court_id: number
          p_is_override?: boolean
          p_match_id: string
          p_session_id: string
          p_team1_score: number
          p_team2_score: number
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      start_group_match_atomic: {
        Args: {
          p_court_number: number
          p_group_id: string
          p_match_id: string
          p_session_id: string
        }
        Returns: Json
      }
      start_match_atomic: {
        Args: {
          p_court_id: number
          p_match_id: string
          p_match_index: number
          p_session_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin"
      court_phase: "idle" | "in_progress" | "completed"
      event_type: "one_off" | "recurring"
      feedback_rating: "loved" | "good" | "okay"
      format_type:
        | "mystery_partner"
        | "round_robin"
        | "format_3"
        | "format_4"
        | "format_5"
      scope_event_type: "social" | "thursdays"
      session_status: "draft" | "live" | "ended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      court_phase: ["idle", "in_progress", "completed"],
      event_type: ["one_off", "recurring"],
      feedback_rating: ["loved", "good", "okay"],
      format_type: [
        "mystery_partner",
        "round_robin",
        "format_3",
        "format_4",
        "format_5",
      ],
      scope_event_type: ["social", "thursdays"],
      session_status: ["draft", "live", "ended"],
    },
  },
} as const
