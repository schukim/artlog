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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      content_search_memo: {
        Row: {
          candidates: Json
          category: Database["public"]["Enums"]["work_category"]
          created_at: string
          creator_normalized: string | null
          creator_raw: string | null
          expires_at: string
          hit_count: number
          id: string
          is_empty: boolean
          language: string
          last_hit_at: string | null
          query_normalized: string | null
          query_raw: string
        }
        Insert: {
          candidates: Json
          category: Database["public"]["Enums"]["work_category"]
          created_at?: string
          creator_normalized?: string | null
          creator_raw?: string | null
          expires_at: string
          hit_count?: number
          id?: string
          is_empty: boolean
          language?: string
          last_hit_at?: string | null
          query_normalized?: string | null
          query_raw: string
        }
        Update: {
          candidates?: Json
          category?: Database["public"]["Enums"]["work_category"]
          created_at?: string
          creator_normalized?: string | null
          creator_raw?: string | null
          expires_at?: string
          hit_count?: number
          id?: string
          is_empty?: boolean
          language?: string
          last_hit_at?: string | null
          query_normalized?: string | null
          query_raw?: string
        }
        Relationships: []
      }
      contents: {
        Row: {
          category: string
          created_at: string
          creator: string | null
          genre: string | null
          id: string
          metadata: Json | null
          original_title: string | null
          title: string
          user_id: string
          year: number | null
        }
        Insert: {
          category: string
          created_at?: string
          creator?: string | null
          genre?: string | null
          id?: string
          metadata?: Json | null
          original_title?: string | null
          title: string
          user_id: string
          year?: number | null
        }
        Update: {
          category?: string
          created_at?: string
          creator?: string | null
          genre?: string | null
          id?: string
          metadata?: Json | null
          original_title?: string | null
          title?: string
          user_id?: string
          year?: number | null
        }
        Relationships: []
      }
      guest_usage: {
        Row: {
          action: string
          count: number
          day: string
          guest_id: string
          updated_at: string
        }
        Insert: {
          action: string
          count?: number
          day: string
          guest_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          count?: number
          day?: string
          guest_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ingestion_runs: {
        Row: {
          completed_at: string | null
          cursor_position: string | null
          error: string | null
          id: string
          job_type: string
          records_failed: number | null
          records_processed: number | null
          records_updated: number | null
          retry_count: number | null
          source: string
          started_at: string | null
          stats: Json | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          cursor_position?: string | null
          error?: string | null
          id?: string
          job_type?: string
          records_failed?: number | null
          records_processed?: number | null
          records_updated?: number | null
          retry_count?: number | null
          source: string
          started_at?: string | null
          stats?: Json | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          cursor_position?: string | null
          error?: string | null
          id?: string
          job_type?: string
          records_failed?: number | null
          records_processed?: number | null
          records_updated?: number | null
          retry_count?: number | null
          source?: string
          started_at?: string | null
          stats?: Json | null
          status?: string
        }
        Relationships: []
      }
      interviews: {
        Row: {
          conversation: Json
          created_at: string
          id: string
          question_count: number
          review_generate_count: number
          review_id: string | null
          status: string
          updated_at: string
          user_id: string
          work_id: string | null
        }
        Insert: {
          conversation?: Json
          created_at?: string
          id?: string
          question_count?: number
          review_generate_count?: number
          review_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          work_id?: string | null
        }
        Update: {
          conversation?: Json
          created_at?: string
          id?: string
          question_count?: number
          review_generate_count?: number
          review_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interviews_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          created_at: string
          id: string
          prompt: string | null
          results: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          prompt?: string | null
          results?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          prompt?: string | null
          results?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      review_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating: string
          reason: string | null
          review_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating: string
          reason?: string | null
          review_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating?: string
          reason?: string | null
          review_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_feedback_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string
          created_at: string
          experience_date: string | null
          id: string
          title: string | null
          updated_at: string
          user_id: string
          work_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          experience_date?: string | null
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
          work_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          experience_date?: string | null
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      taste_profiles: {
        Row: {
          created_at: string
          id: string
          profile_sentences: string[]
          recommendation_hook: string | null
          review_count: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_sentences: string[]
          recommendation_hook?: string | null
          review_count?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_sentences?: string[]
          recommendation_hook?: string | null
          review_count?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "taste_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ref_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ref_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ref_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          language: string | null
          nickname: string
          plan: string
          preferred_categories: string[] | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id: string
          language?: string | null
          nickname: string
          plan?: string
          preferred_categories?: string[] | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          language?: string | null
          nickname?: string
          plan?: string
          preferred_categories?: string[] | null
        }
        Relationships: []
      }
      work_aliases: {
        Row: {
          alias_normalized: string | null
          alias_raw: string
          category: Database["public"]["Enums"]["work_category"]
          created_at: string
          hit_count: number
          id: string
          last_hit_at: string | null
          work_id: string
        }
        Insert: {
          alias_normalized?: string | null
          alias_raw: string
          category: Database["public"]["Enums"]["work_category"]
          created_at?: string
          hit_count?: number
          id?: string
          last_hit_at?: string | null
          work_id: string
        }
        Update: {
          alias_normalized?: string | null
          alias_raw?: string
          category?: Database["public"]["Enums"]["work_category"]
          created_at?: string
          hit_count?: number
          id?: string
          last_hit_at?: string | null
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_aliases_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      works: {
        Row: {
          category: Database["public"]["Enums"]["work_category"]
          contributing_sources: string[] | null
          created_at: string | null
          creator: string | null
          external_ids: Json | null
          genre: string | null
          id: string
          is_verified: boolean | null
          last_synced_at: string | null
          metadata: Json
          original_title: string | null
          original_title_normalized: string | null
          primary_source: string | null
          sync_status: string | null
          title: string
          title_embedding: string | null
          title_normalized: string | null
          updated_at: string | null
          user_id: string | null
          verified_at: string | null
          year: number | null
        }
        Insert: {
          category: Database["public"]["Enums"]["work_category"]
          contributing_sources?: string[] | null
          created_at?: string | null
          creator?: string | null
          external_ids?: Json | null
          genre?: string | null
          id?: string
          is_verified?: boolean | null
          last_synced_at?: string | null
          metadata?: Json
          original_title?: string | null
          original_title_normalized?: string | null
          primary_source?: string | null
          sync_status?: string | null
          title: string
          title_embedding?: string | null
          title_normalized?: string | null
          updated_at?: string | null
          user_id?: string | null
          verified_at?: string | null
          year?: number | null
        }
        Update: {
          category?: Database["public"]["Enums"]["work_category"]
          contributing_sources?: string[] | null
          created_at?: string | null
          creator?: string | null
          external_ids?: Json | null
          genre?: string | null
          id?: string
          is_verified?: boolean | null
          last_synced_at?: string | null
          metadata?: Json
          original_title?: string | null
          original_title_normalized?: string | null
          primary_source?: string | null
          sync_status?: string | null
          title?: string
          title_embedding?: string | null
          title_normalized?: string | null
          updated_at?: string | null
          user_id?: string | null
          verified_at?: string | null
          year?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      recent_ingestion_status: {
        Row: {
          completed_at: string | null
          duration: string | null
          error: string | null
          job_type: string | null
          records_failed: number | null
          records_processed: number | null
          records_updated: number | null
          source: string | null
          started_at: string | null
          status: string | null
        }
        Relationships: []
      }
      works_by_source_stats: {
        Row: {
          category: Database["public"]["Enums"]["work_category"] | null
          embedded_works: number | null
          first_created: string | null
          last_sync: string | null
          last_updated: string | null
          source: string | null
          total_works: number | null
          verified_works: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      consume_guest_usage: {
        Args: {
          p_action: string
          p_day: string
          p_global_limit: number
          p_guest_id: string
          p_limit: number
        }
        Returns: Json
      }
      consume_usage: {
        Args: {
          p_action: string
          p_check_hard: boolean
          p_check_period: boolean
          p_day_start: string
          p_grace_limit?: number
          p_hard_limit: number
          p_period_limit: number
          p_period_start: string
          p_ref_id: string
          p_user_id: string
        }
        Returns: Json
      }
      find_potential_duplicates: {
        Args: {
          check_category: Database["public"]["Enums"]["work_category"]
          check_creator?: string
          check_title: string
          threshold?: number
        }
        Returns: {
          creator: string
          id: string
          match_type: string
          similarity_score: number
          title: string
        }[]
      }
      get_cron_jobs_status: {
        Args: never
        Returns: {
          active: boolean
          command: string
          jobid: number
          jobname: string
          last_run: string
          next_run: string
          schedule: string
        }[]
      }
      get_recent_ingestion_status: {
        Args: never
        Returns: {
          completed_at: string
          duration: string
          error: string
          job_type: string
          records_failed: number
          records_processed: number
          records_updated: number
          source: string
          started_at: string
          stats: Json
          status: string
        }[]
      }
      get_works_stats: {
        Args: never
        Returns: {
          category: Database["public"]["Enums"]["work_category"]
          embedded_works: number
          first_created: string
          last_sync: string
          last_updated: string
          source: string
          total_works: number
          verified_works: number
        }[]
      }
      increment_review_generate_count: {
        Args: { p_interview_id: string }
        Returns: undefined
      }
      lookup_work_alias: {
        Args: {
          p_category: Database["public"]["Enums"]["work_category"]
          p_query: string
        }
        Returns: {
          creator: string
          genre: string
          id: string
          metadata: Json
          original_title: string
          title: string
          year: number
        }[]
      }
      normalize_title: { Args: { title: string }; Returns: string }
      record_work_alias: {
        Args: {
          p_category: Database["public"]["Enums"]["work_category"]
          p_query: string
          p_work_id: string
        }
        Returns: undefined
      }
      search_memo_get: {
        Args: {
          p_category: Database["public"]["Enums"]["work_category"]
          p_creator?: string
          p_language?: string
          p_query: string
        }
        Returns: Json
      }
      search_memo_put: {
        Args: {
          p_candidates: Json
          p_category: Database["public"]["Enums"]["work_category"]
          p_creator?: string
          p_language?: string
          p_query: string
          p_ttl_days?: number
        }
        Returns: undefined
      }
      search_works: {
        Args: {
          embedding_weight?: number
          limit_count?: number
          query_embedding?: string
          query_text: string
          target_category?: Database["public"]["Enums"]["work_category"]
          trigram_weight?: number
        }
        Returns: {
          category: Database["public"]["Enums"]["work_category"]
          creator: string
          embedding_score: number
          external_ids: Json
          genre: string
          id: string
          is_verified: boolean
          match_reason: string
          metadata: Json
          original_title: string
          primary_source: string
          similarity_score: number
          title: string
          trigram_score: number
          year: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      work_category:
        | "movie"
        | "music"
        | "book"
        | "art"
        | "exhibition"
        | "performance"
        | "series"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      work_category: [
        "movie",
        "music",
        "book",
        "art",
        "exhibition",
        "performance",
        "series",
      ],
    },
  },
} as const
