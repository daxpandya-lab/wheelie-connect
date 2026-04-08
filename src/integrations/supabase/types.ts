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
      automation_logs: {
        Row: {
          actions_executed: Json | null
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          id: string
          rule_id: string
          status: string
          tenant_id: string
          trigger_data: Json | null
          trigger_event: string
        }
        Insert: {
          actions_executed?: Json | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          rule_id: string
          status?: string
          tenant_id: string
          trigger_data?: Json | null
          trigger_event: string
        }
        Update: {
          actions_executed?: Json | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          rule_id?: string
          status?: string
          tenant_id?: string
          trigger_data?: Json | null
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          actions: Json
          conditions: Json
          created_at: string
          created_by: string | null
          description: string | null
          execution_count: number
          id: string
          is_active: boolean
          last_executed_at: string | null
          name: string
          tenant_id: string
          trigger_event: string
          trigger_table: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_count?: number
          id?: string
          is_active?: boolean
          last_executed_at?: string | null
          name: string
          tenant_id: string
          trigger_event: string
          trigger_table: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_count?: number
          id?: string
          is_active?: boolean
          last_executed_at?: string | null
          name?: string
          tenant_id?: string
          trigger_event?: string
          trigger_table?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          customer_id: string | null
          customer_name: string | null
          delivered_at: string | null
          error_message: string | null
          id: string
          phone_number: string
          read_at: string | null
          replied_at: string | null
          reply_text: string | null
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          phone_number: string
          read_at?: string | null
          replied_at?: string | null
          reply_text?: string | null
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          phone_number?: string
          read_at?: string | null
          replied_at?: string | null
          reply_text?: string | null
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_filter: Json | null
          created_at: string
          delivered_count: number | null
          id: string
          name: string
          read_count: number | null
          recipient_count: number | null
          replied_count: number | null
          scheduled_at: string | null
          segment_id: string | null
          sent_count: number | null
          status: Database["public"]["Enums"]["campaign_status"]
          template_id: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["campaign_type"]
          updated_at: string
        }
        Insert: {
          audience_filter?: Json | null
          created_at?: string
          delivered_count?: number | null
          id?: string
          name: string
          read_count?: number | null
          recipient_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          segment_id?: string | null
          sent_count?: number | null
          status?: Database["public"]["Enums"]["campaign_status"]
          template_id?: string | null
          tenant_id: string
          type?: Database["public"]["Enums"]["campaign_type"]
          updated_at?: string
        }
        Update: {
          audience_filter?: Json | null
          created_at?: string
          delivered_count?: number | null
          id?: string
          name?: string
          read_count?: number | null
          recipient_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          segment_id?: string | null
          sent_count?: number | null
          status?: Database["public"]["Enums"]["campaign_status"]
          template_id?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["campaign_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "contact_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_conversations: {
        Row: {
          assigned_agent: string | null
          channel: Database["public"]["Enums"]["conversation_channel"]
          customer_id: string | null
          ended_at: string | null
          id: string
          metadata: Json | null
          phone_number: string | null
          started_at: string
          status: Database["public"]["Enums"]["conversation_status"]
          tenant_id: string
        }
        Insert: {
          assigned_agent?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel"]
          customer_id?: string | null
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          phone_number?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          tenant_id: string
        }
        Update: {
          assigned_agent?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel"]
          customer_id?: string | null
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          phone_number?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_flows: {
        Row: {
          channel: Database["public"]["Enums"]["conversation_channel"]
          created_at: string
          description: string | null
          flow_data: Json
          id: string
          is_active: boolean
          language: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["conversation_channel"]
          created_at?: string
          description?: string | null
          flow_data?: Json
          id?: string
          is_active?: boolean
          language?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["conversation_channel"]
          created_at?: string
          description?: string | null
          flow_data?: Json
          id?: string
          is_active?: boolean
          language?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_flows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_messages: {
        Row: {
          content: string
          conversation_id: string
          id: string
          message_type: Database["public"]["Enums"]["message_type"]
          metadata: Json | null
          sender_type: Database["public"]["Enums"]["message_sender"]
          sent_at: string
          tenant_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          id?: string
          message_type?: Database["public"]["Enums"]["message_type"]
          metadata?: Json | null
          sender_type: Database["public"]["Enums"]["message_sender"]
          sent_at?: string
          tenant_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          id?: string
          message_type?: Database["public"]["Enums"]["message_type"]
          metadata?: Json | null
          sender_type?: Database["public"]["Enums"]["message_sender"]
          sent_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chatbot_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_responses: {
        Row: {
          confidence_score: number | null
          conversation_id: string
          created_at: string
          feedback: string | null
          flow_id: string | null
          id: string
          intent_detected: string | null
          message_id: string | null
          response_text: string | null
          response_time_ms: number | null
          tenant_id: string
          was_helpful: boolean | null
        }
        Insert: {
          confidence_score?: number | null
          conversation_id: string
          created_at?: string
          feedback?: string | null
          flow_id?: string | null
          id?: string
          intent_detected?: string | null
          message_id?: string | null
          response_text?: string | null
          response_time_ms?: number | null
          tenant_id: string
          was_helpful?: boolean | null
        }
        Update: {
          confidence_score?: number | null
          conversation_id?: string
          created_at?: string
          feedback?: string | null
          flow_id?: string | null
          id?: string
          intent_detected?: string | null
          message_id?: string | null
          response_text?: string | null
          response_time_ms?: number | null
          tenant_id?: string
          was_helpful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_responses_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chatbot_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_responses_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "chatbot_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_responses_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chatbot_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_segments: {
        Row: {
          created_at: string
          customer_count: number | null
          description: string | null
          filter_criteria: Json
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_count?: number | null
          description?: string | null
          filter_criteria?: Json
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_count?: number | null
          description?: string | null
          filter_criteria?: Json
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_segments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          created_at: string
          customer_id: string | null
          customer_name: string
          email: string | null
          follow_up_date: string | null
          id: string
          notes: string | null
          phone_number: string | null
          score: number | null
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at: string
          vehicle_interest: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name: string
          email?: string | null
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          phone_number?: string | null
          score?: number | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at?: string
          vehicle_interest?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          email?: string | null
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          phone_number?: string | null
          score?: number | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id?: string
          updated_at?: string
          vehicle_interest?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          source: string | null
          source_id: string | null
          tenant_id: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          source?: string | null
          source_id?: string | null
          tenant_id: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          source?: string | null
          source_id?: string | null
          tenant_id?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          created_at: string
          id: string
          key: string
          last_refill_at: string
          max_tokens: number
          refill_rate: number
          tokens: number
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          last_refill_at?: string
          max_tokens?: number
          refill_rate?: number
          tokens?: number
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          last_refill_at?: string
          max_tokens?: number
          refill_rate?: number
          tokens?: number
        }
        Relationships: []
      }
      service_bookings: {
        Row: {
          assigned_to: string | null
          booking_date: string
          created_at: string
          customer_id: string | null
          customer_name: string
          drop_required: boolean | null
          id: string
          kms_driven: number | null
          notes: string | null
          phone_number: string
          pickup_required: boolean | null
          preferred_time: string | null
          service_type: string
          status: Database["public"]["Enums"]["service_status"]
          tenant_id: string
          total_amount: number | null
          updated_at: string
          vehicle_id: string | null
          vehicle_model: string
        }
        Insert: {
          assigned_to?: string | null
          booking_date: string
          created_at?: string
          customer_id?: string | null
          customer_name: string
          drop_required?: boolean | null
          id?: string
          kms_driven?: number | null
          notes?: string | null
          phone_number: string
          pickup_required?: boolean | null
          preferred_time?: string | null
          service_type: string
          status?: Database["public"]["Enums"]["service_status"]
          tenant_id: string
          total_amount?: number | null
          updated_at?: string
          vehicle_id?: string | null
          vehicle_model: string
        }
        Update: {
          assigned_to?: string | null
          booking_date?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          drop_required?: boolean | null
          id?: string
          kms_driven?: number | null
          notes?: string | null
          phone_number?: string
          pickup_required?: boolean | null
          preferred_time?: string | null
          service_type?: string
          status?: Database["public"]["Enums"]["service_status"]
          tenant_id?: string
          total_amount?: number | null
          updated_at?: string
          vehicle_id?: string | null
          vehicle_model?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_bookings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: Database["public"]["Enums"]["tenant_plan"]
          settings: Json | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          subscription_end_date: string | null
          subscription_start_date: string | null
          updated_at: string
          whatsapp_config: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: Database["public"]["Enums"]["tenant_plan"]
          settings?: Json | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          updated_at?: string
          whatsapp_config?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["tenant_plan"]
          settings?: Json | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          updated_at?: string
          whatsapp_config?: Json | null
        }
        Relationships: []
      }
      test_drive_bookings: {
        Row: {
          assigned_to: string | null
          created_at: string
          customer_id: string | null
          customer_name: string
          follow_up_date: string | null
          id: string
          notes: string | null
          phone_number: string
          preferred_date: string
          preferred_time: string | null
          status: Database["public"]["Enums"]["service_status"]
          tenant_id: string
          updated_at: string
          vehicle_model: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name: string
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          phone_number: string
          preferred_date: string
          preferred_time?: string | null
          status?: Database["public"]["Enums"]["service_status"]
          tenant_id: string
          updated_at?: string
          vehicle_model: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          follow_up_date?: string | null
          id?: string
          notes?: string | null
          phone_number?: string
          preferred_date?: string
          preferred_time?: string | null
          status?: Database["public"]["Enums"]["service_status"]
          tenant_id?: string
          updated_at?: string
          vehicle_model?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_drive_bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_drive_bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          kms_driven: number | null
          license_plate: string | null
          make: string | null
          model: string
          tenant_id: string
          updated_at: string
          vin: string | null
          year: number | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          kms_driven?: number | null
          license_plate?: string | null
          make?: string | null
          model: string
          tenant_id: string
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          kms_driven?: number | null
          license_plate?: string | null
          make?: string | null
          model?: string
          tenant_id?: string
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_queue: {
        Row: {
          attempts: number
          content: string | null
          conversation_id: string | null
          created_at: string
          error_message: string | null
          external_message_id: string | null
          id: string
          last_attempt_at: string | null
          message_type: string
          recipient_phone: string
          status: Database["public"]["Enums"]["wa_message_status"]
          template_name: string | null
          template_params: Json | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          last_attempt_at?: string | null
          message_type?: string
          recipient_phone: string
          status?: Database["public"]["Enums"]["wa_message_status"]
          template_name?: string | null
          template_params?: Json | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          last_attempt_at?: string | null
          message_type?: string
          recipient_phone?: string
          status?: Database["public"]["Enums"]["wa_message_status"]
          template_name?: string | null
          template_params?: Json | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chatbot_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_message_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_webhook_at: string | null
          phone_number_id: string
          tenant_id: string
          updated_at: string
          verify_token: string
          waba_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_webhook_at?: string | null
          phone_number_id: string
          tenant_id: string
          updated_at?: string
          verify_token?: string
          waba_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_webhook_at?: string | null
          phone_number_id?: string
          tenant_id?: string
          updated_at?: string
          verify_token?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          category: Database["public"]["Enums"]["wa_template_category"]
          components: Json
          created_at: string
          id: string
          language: string
          status: Database["public"]["Enums"]["wa_template_status"]
          template_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["wa_template_category"]
          components?: Json
          created_at?: string
          id?: string
          language?: string
          status?: Database["public"]["Enums"]["wa_template_status"]
          template_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["wa_template_category"]
          components?: Json
          created_at?: string
          id?: string
          language?: string
          status?: Database["public"]["Enums"]["wa_template_status"]
          template_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          _key: string
          _max_tokens?: number
          _refill_rate?: number
          _window_seconds?: number
        }
        Returns: boolean
      }
      get_user_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_active: { Args: never; Returns: boolean }
      is_tenant_id_active: { Args: { _tenant_id: string }; Returns: boolean }
      is_user_tenant: { Args: { _tenant_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "super_admin" | "tenant_admin" | "staff"
      campaign_status: "draft" | "scheduled" | "sending" | "sent" | "cancelled"
      campaign_type: "whatsapp" | "sms" | "email"
      conversation_channel: "whatsapp" | "web" | "both"
      conversation_status: "active" | "closed" | "escalated"
      lead_source: "whatsapp" | "web" | "walkin" | "referral" | "campaign"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "won"
        | "lost"
      message_sender: "customer" | "bot" | "agent"
      message_type: "text" | "image" | "document" | "template"
      service_status:
        | "pending"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
      tenant_plan: "free" | "starter" | "pro" | "enterprise"
      tenant_status: "active" | "suspended" | "cancelled"
      wa_message_status:
        | "queued"
        | "sending"
        | "sent"
        | "failed"
        | "delivered"
        | "read"
      wa_template_category: "marketing" | "utility" | "authentication"
      wa_template_status: "pending" | "approved" | "rejected"
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
    Enums: {
      app_role: ["super_admin", "tenant_admin", "staff"],
      campaign_status: ["draft", "scheduled", "sending", "sent", "cancelled"],
      campaign_type: ["whatsapp", "sms", "email"],
      conversation_channel: ["whatsapp", "web", "both"],
      conversation_status: ["active", "closed", "escalated"],
      lead_source: ["whatsapp", "web", "walkin", "referral", "campaign"],
      lead_status: ["new", "contacted", "qualified", "proposal", "won", "lost"],
      message_sender: ["customer", "bot", "agent"],
      message_type: ["text", "image", "document", "template"],
      service_status: [
        "pending",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
      ],
      tenant_plan: ["free", "starter", "pro", "enterprise"],
      tenant_status: ["active", "suspended", "cancelled"],
      wa_message_status: [
        "queued",
        "sending",
        "sent",
        "failed",
        "delivered",
        "read",
      ],
      wa_template_category: ["marketing", "utility", "authentication"],
      wa_template_status: ["pending", "approved", "rejected"],
    },
  },
} as const
