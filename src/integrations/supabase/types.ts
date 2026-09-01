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
      blocked_identifiers: {
        Row: {
          created_at: string
          id: string
          note: string | null
          type: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          type: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          type?: string
          value?: string
        }
        Relationships: []
      }
      group_blacklist: {
        Row: {
          created_at: string
          id: string
          phone: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          reason?: string | null
        }
        Relationships: []
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          member_jid: string | null
          member_name: string | null
          name: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          member_jid?: string | null
          member_name?: string | null
          name?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          member_jid?: string | null
          member_name?: string | null
          name?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      group_settings: {
        Row: {
          close_message: string | null
          created_at: string | null
          group_id: string
          group_mode: string | null
          group_name: string | null
          id: string
          is_open: boolean
          last_sync_at: string | null
          left_message: string | null
          member_count: number
          open_message: string | null
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          close_message?: string | null
          created_at?: string | null
          group_id: string
          group_mode?: string | null
          group_name?: string | null
          id?: string
          is_open?: boolean
          last_sync_at?: string | null
          left_message?: string | null
          member_count?: number
          open_message?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          close_message?: string | null
          created_at?: string | null
          group_id?: string
          group_mode?: string | null
          group_name?: string | null
          id?: string
          is_open?: boolean
          last_sync_at?: string | null
          left_message?: string | null
          member_count?: number
          open_message?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Relationships: []
      }
      merchant_videos: {
        Row: {
          auto_approved_count: number | null
          created_at: string
          duplicates_skipped: number | null
          duration_seconds: number | null
          file_name: string
          file_size_bytes: number | null
          id: string
          matched_count: number | null
          processing_time_ms: number | null
          status: string
          total_frames: number | null
          transactions_parsed: number | null
          updated_at: string
          used_frames: number | null
        }
        Insert: {
          auto_approved_count?: number | null
          created_at?: string
          duplicates_skipped?: number | null
          duration_seconds?: number | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          matched_count?: number | null
          processing_time_ms?: number | null
          status?: string
          total_frames?: number | null
          transactions_parsed?: number | null
          updated_at?: string
          used_frames?: number | null
        }
        Update: {
          auto_approved_count?: number | null
          created_at?: string
          duplicates_skipped?: number | null
          duration_seconds?: number | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          matched_count?: number | null
          processing_time_ms?: number | null
          status?: string
          total_frames?: number | null
          transactions_parsed?: number | null
          updated_at?: string
          used_frames?: number | null
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          auto_reject_admin_phone: string | null
          auto_reject_message: string | null
          auto_reject_notify_type: string | null
          auto_reject_reaction: string | null
          id: string
          message_approved: string
          message_rejected: string
          mode: string
          reaction_approved: string
          reaction_rejected: string
          updated_at: string
        }
        Insert: {
          auto_reject_admin_phone?: string | null
          auto_reject_message?: string | null
          auto_reject_notify_type?: string | null
          auto_reject_reaction?: string | null
          id?: string
          message_approved?: string
          message_rejected?: string
          mode?: string
          reaction_approved?: string
          reaction_rejected?: string
          updated_at?: string
        }
        Update: {
          auto_reject_admin_phone?: string | null
          auto_reject_message?: string | null
          auto_reject_notify_type?: string | null
          auto_reject_reaction?: string | null
          id?: string
          message_approved?: string
          message_rejected?: string
          mode?: string
          reaction_approved?: string
          reaction_rejected?: string
          updated_at?: string
        }
        Relationships: []
      }
      receipt_wa_messages: {
        Row: {
          created_at: string
          from_me: boolean | null
          group_id: string | null
          group_name: string | null
          id: string
          is_group: boolean
          key_json: Json | null
          message_json: Json | null
          participant: string | null
          phone: string
          processing_msg_id: string | null
          receipt_id: string
          remote_jid: string | null
          wa_message_id: string | null
        }
        Insert: {
          created_at?: string
          from_me?: boolean | null
          group_id?: string | null
          group_name?: string | null
          id?: string
          is_group?: boolean
          key_json?: Json | null
          message_json?: Json | null
          participant?: string | null
          phone: string
          processing_msg_id?: string | null
          receipt_id: string
          remote_jid?: string | null
          wa_message_id?: string | null
        }
        Update: {
          created_at?: string
          from_me?: boolean | null
          group_id?: string | null
          group_name?: string | null
          id?: string
          is_group?: boolean
          key_json?: Json | null
          message_json?: Json | null
          participant?: string | null
          phone?: string
          processing_msg_id?: string | null
          receipt_id?: string
          remote_jid?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_wa_messages_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          image_url: string
          jam_transfer: string
          keterangan: string
          nama: string
          nominal: number
          nomor_hp: string
          ocr_confidence: number | null
          ocr_source: string | null
          ocr_status: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          image_url: string
          jam_transfer: string
          keterangan: string
          nama: string
          nominal: number
          nomor_hp: string
          ocr_confidence?: number | null
          ocr_source?: string | null
          ocr_status?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          image_url?: string
          jam_transfer?: string
          keterangan?: string
          nama?: string
          nominal?: number
          nomor_hp?: string
          ocr_confidence?: number | null
          ocr_source?: string | null
          ocr_status?: string | null
          status?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          kode_transaksi: string | null
          matched_receipt_id: string | null
          nominal: number
          ocr_confidence: number | null
          raw_ocr: string | null
          status_match: string
          transaction_date: string
          transaction_time: string
          updated_at: string
          video_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          kode_transaksi?: string | null
          matched_receipt_id?: string | null
          nominal: number
          ocr_confidence?: number | null
          raw_ocr?: string | null
          status_match?: string
          transaction_date?: string
          transaction_time: string
          updated_at?: string
          video_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          kode_transaksi?: string | null
          matched_receipt_id?: string | null
          nominal?: number
          ocr_confidence?: number | null
          raw_ocr?: string | null
          status_match?: string
          transaction_date?: string
          transaction_time?: string
          updated_at?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "merchant_videos"
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
      wa_queue_lock: {
        Row: {
          id: number
          is_running: boolean | null
          updated_at: string | null
        }
        Insert: {
          id: number
          is_running?: boolean | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          is_running?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wa_send_queue: {
        Row: {
          created_at: string | null
          id: string
          mentions: Json | null
          processing: boolean | null
          status: string | null
          target: string | null
          text: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          mentions?: Json | null
          processing?: boolean | null
          status?: string | null
          target?: string | null
          text?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          mentions?: Json | null
          processing?: boolean | null
          status?: string | null
          target?: string | null
          text?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_merchant_transactions: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      wa_acquire_send_lock: { Args: never; Returns: undefined }
      wa_release_send_lock: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "user"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
