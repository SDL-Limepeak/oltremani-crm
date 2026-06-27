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
      audit_log: {
        Row: {
          action: string
          changed_by_user_id: string | null
          created_at: string
          id: string
          log_type: string
          model_name: string | null
          new_values_json: Json | null
          old_values_json: Json | null
          record_id: string | null
          source: string | null
        }
        Insert: {
          action: string
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          log_type: string
          model_name?: string | null
          new_values_json?: Json | null
          old_values_json?: Json | null
          record_id?: string | null
          source?: string | null
        }
        Update: {
          action?: string
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          log_type?: string
          model_name?: string | null
          new_values_json?: Json | null
          old_values_json?: Json | null
          record_id?: string | null
          source?: string | null
        }
        Relationships: []
      }
      membership_subscription: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          notes: string | null
          partner_id: string
          start_date: string
          status: string
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          partner_id: string
          start_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          partner_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "membership_subscription_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "res_partner"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_consent: {
        Row: {
          accepted: boolean
          accepted_at: string | null
          consent_type: string
          created_at: string
          id: string
          ip_address: string | null
          notes: string | null
          partner_id: string
          source: string | null
          user_agent: string | null
          version: string | null
        }
        Insert: {
          accepted?: boolean
          accepted_at?: string | null
          consent_type: string
          created_at?: string
          id?: string
          ip_address?: string | null
          notes?: string | null
          partner_id: string
          source?: string | null
          user_agent?: string | null
          version?: string | null
        }
        Update: {
          accepted?: boolean
          accepted_at?: string | null
          consent_type?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          notes?: string | null
          partner_id?: string
          source?: string | null
          user_agent?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "privacy_consent_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "res_partner"
            referencedColumns: ["id"]
          },
        ]
      }
      res_city: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          name: string
          province: string | null
          province_code: string | null
          region: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          name: string
          province?: string | null
          province_code?: string | null
          region?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          name?: string
          province?: string | null
          province_code?: string | null
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "res_city_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "res_partner_category"
            referencedColumns: ["id"]
          },
        ]
      }
      res_partner: {
        Row: {
          city_id: string | null
          created_at: string
          created_by: string | null
          display_name: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          mobile: string | null
          notes: string | null
          partner_type: string
          phone: string | null
          raw_city: string | null
          raw_province: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city_id?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          partner_type?: string
          phone?: string | null
          raw_city?: string | null
          raw_province?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city_id?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          partner_type?: string
          phone?: string | null
          raw_city?: string | null
          raw_province?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "res_partner_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "res_city"
            referencedColumns: ["id"]
          },
        ]
      }
      res_partner_category: {
        Row: {
          activation_date: string | null
          address: string | null
          category_type: string
          city: string | null
          created_at: string
          fiscal_code: string | null
          iban: string | null
          id: string
          mobile: string | null
          name: string
          parent_id: string | null
          phone: string | null
          president_email: string | null
          president_first_name: string | null
          president_last_name: string | null
          province_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activation_date?: string | null
          address?: string | null
          category_type?: string
          city?: string | null
          created_at?: string
          fiscal_code?: string | null
          iban?: string | null
          id?: string
          mobile?: string | null
          name: string
          parent_id?: string | null
          phone?: string | null
          president_email?: string | null
          president_first_name?: string | null
          president_last_name?: string | null
          province_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          activation_date?: string | null
          address?: string | null
          category_type?: string
          city?: string | null
          created_at?: string
          fiscal_code?: string | null
          iban?: string | null
          id?: string
          mobile?: string | null
          name?: string
          parent_id?: string | null
          phone?: string | null
          president_email?: string | null
          president_first_name?: string | null
          president_last_name?: string | null
          province_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "res_partner_category_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "res_partner_category"
            referencedColumns: ["id"]
          },
        ]
      }
      res_partner_category_rel: {
        Row: {
          category_id: string
          created_at: string
          partner_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          partner_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "res_partner_category_rel_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "res_partner_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "res_partner_category_rel_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "res_partner"
            referencedColumns: ["id"]
          },
        ]
      }
      res_user_category_rel: {
        Row: {
          category_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "res_user_category_rel_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "res_partner_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "res_user_category_rel_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "res_users"
            referencedColumns: ["id"]
          },
        ]
      }
      res_users: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_see_partner: {
        Args: { _partner_id: string; _uid: string }
        Returns: boolean
      }
      current_role_name: { Args: never; Returns: string }
      has_role: { Args: { _role: string; _uid: string }; Returns: boolean }
      is_admin_or_super: { Args: { _uid: string }; Returns: boolean }
      visible_category_ids: { Args: { _uid: string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
