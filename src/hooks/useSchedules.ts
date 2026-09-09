/**
 * Scheduling layer (admin only).
 *
 * Recurring Thursdays keep a rolling window of DRAFT sessions + exact Shopify
 * mappings; Socials are created by hand. Nothing here ever starts scoring:
 * every write goes through an admin-checked SECURITY DEFINER RPC and the
 * generated sessions stay `draft` / `is_active = false`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const SCHEDULES_QUERY_KEY = "recurring_schedules";
export const SCHEDULE_EXCEPTIONS_QUERY_KEY = "recurring_schedule_exceptions";
export const UPCOMING_SESSIONS_QUERY_KEY = "upcoming_sessions";

export type ScheduleRow = Database["public"]["Tables"]["recurring_experience_schedules"]["Row"];
export type ScheduleExceptionRow =
  Database["public"]["Tables"]["recurring_experience_exceptions"]["Row"];

/** Registration statuses that legitimately consume a seat (mirrors session_booked_seats). */
export const CAPACITY_CONSUMING_STATUSES = ["paid", "profile_required", "confirmed"] as const;

export const todayIsoDate = (now: Date = new Date()): string => {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export interface UpcomingSessionMapping {
  occurrence_key: string | null;
  shopify_variant_id: string | null;
  shopify_product_id: string | null;
  is_active: boolean;
}

export interface UpcomingSession {
  id: string;
  date: string;
  status: "draft" | "live" | "ended";
  is_active: boolean;
  city_id: string;
  location_id: string | null;
  event_type: "social" | "thursdays";
  session_label: string | null;
  capacity: number | null;
  recurring_schedule_id: string | null;
  mappings: UpcomingSessionMapping[];
  /** Seats that consume capacity (cancelled / refunded excluded). */
  booked: number;
  /** Every registration attached to the session, terminal ones included. */
  registrations: number;
  remaining: number | null;
  soldOut: boolean;
  shopifyLinked: boolean;
}

const SESSION_COLUMNS =
  "id, date, status, is_active, city_id, location_id, event_type, session_label, capacity, recurring_schedule_id";

/** Recurring schedule configs (admin RLS). */
export function useRecurringSchedules() {
  return useQuery({
    queryKey: [SCHEDULES_QUERY_KEY],
    queryFn: async (): Promise<ScheduleRow[]> => {
      const { data, error } = await supabase
        .from("recurring_experience_schedules")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useScheduleExceptions() {
  return useQuery({
    queryKey: [SCHEDULE_EXCEPTIONS_QUERY_KEY],
    queryFn: async (): Promise<ScheduleExceptionRow[]> => {
      const { data, error } = await supabase
        .from("recurring_experience_exceptions")
        .select("*")
        .order("date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Upcoming (today onwards) sessions for one event type with their Shopify
 * mapping visibility and capacity/booked numbers.
 */
export function useUpcomingSessions(eventType: "social" | "thursdays" | null) {
  return useQuery({
    queryKey: [UPCOMING_SESSIONS_QUERY_KEY, eventType],
    enabled: Boolean(eventType),
    refetchInterval: 60_000,
    queryFn: async (): Promise<UpcomingSession[]> => {
      const today = todayIsoDate();
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select(SESSION_COLUMNS)
        .eq("event_type", eventType!)
        .gte("date", today)
        .order("date", { ascending: true })
        .limit(200);
      if (error) throw error;
      const rows = sessions ?? [];
      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      const [mappingsRes, registrationsRes] = await Promise.all([
        supabase
          .from("shopify_session_mappings")
          .select("session_id, occurrence_key, shopify_variant_id, shopify_product_id, is_active")
          .in("session_id", ids),
        supabase
          .from("experience_registrations")
          .select("session_id, status, cancelled_at, refunded_at")
          .in("session_id", ids),
      ]);
      if (mappingsRes.error) throw mappingsRes.error;
      if (registrationsRes.error) throw registrationsRes.error;

      return rows.map((row) => {
        const mappings = (mappingsRes.data ?? [])
          .filter((m) => m.session_id === row.id)
          .map(({ occurrence_key, shopify_variant_id, shopify_product_id, is_active }) => ({
            occurrence_key,
            shopify_variant_id,
            shopify_product_id,
            is_active: Boolean(is_active),
          }));
        const regs = (registrationsRes.data ?? []).filter((r) => r.session_id === row.id);
        const booked = regs.filter(
          (r) =>
            (CAPACITY_CONSUMING_STATUSES as readonly string[]).includes(r.status) &&
            !r.cancelled_at &&
            !r.refunded_at,
        ).length;
        const capacity = row.capacity ?? null;
        const remaining = capacity === null ? null : Math.max(capacity - booked, 0);
        return {
          ...row,
          status: row.status as UpcomingSession["status"],
          event_type: row.event_type as UpcomingSession["event_type"],
          capacity,
          mappings,
          booked,
          registrations: regs.length,
          remaining,
          soldOut: capacity !== null && booked >= capacity,
          shopifyLinked: mappings.some((m) => m.is_active),
        } satisfies UpcomingSession;
      });
    },
  });
}

type RpcResult = { ok?: boolean; error?: string; conflict?: string; [key: string]: unknown };

const asResult = (data: unknown): RpcResult =>
  data && typeof data === "object" ? (data as RpcResult) : {};

/** All schedule mutations. Every one refreshes the schedule + session lists. */
export function useScheduleMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [SCHEDULES_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: [SCHEDULE_EXCEPTIONS_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: [UPCOMING_SESSIONS_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["active_session"] });
  };

  const call = async (fn: () => Promise<{ data: unknown; error: unknown }>) => {
    const { data, error } = await fn();
    if (error) throw new Error((error as { message?: string }).message || "Request failed");
    const result = asResult(data);
    if (result.ok === false) throw new Error(result.error || "Request failed");
    return result;
  };

  const reconcile = useMutation({
    mutationFn: (scheduleId?: string) =>
      call(() =>
        supabase.rpc("admin_reconcile_recurring_schedules", {
          p_schedule_id: scheduleId ?? undefined,
        }),
      ),
    onSuccess: (result) => {
      invalidate();
      const created = Number(result.sessions_created ?? 0);
      toast.success(
        created > 0
          ? `${created} upcoming date${created === 1 ? "" : "s"} added.`
          : "Schedule is already up to date.",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setScheduleActive = useMutation({
    mutationFn: (vars: { scheduleId: string; active: boolean }) =>
      call(() =>
        supabase.rpc("admin_set_recurring_schedule_active", {
          p_schedule_id: vars.scheduleId,
          p_active: vars.active,
        }),
      ),
    onSuccess: (_r, vars) => {
      invalidate();
      toast.success(vars.active ? "Schedule resumed." : "Schedule paused.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const skipDate = useMutation({
    mutationFn: (vars: { scheduleId: string; date: string; note?: string }) =>
      call(() =>
        supabase.rpc("admin_skip_recurring_date", {
          p_schedule_id: vars.scheduleId,
          p_date: vars.date,
          p_note: vars.note ?? undefined,
        }),
      ),
    onSuccess: () => {
      invalidate();
      toast.success("Date skipped and removed from the store.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unskipDate = useMutation({
    mutationFn: (vars: { scheduleId: string; date: string }) =>
      call(() =>
        supabase.rpc("admin_unskip_recurring_date", {
          p_schedule_id: vars.scheduleId,
          p_date: vars.date,
        }),
      ),
    onSuccess: () => {
      invalidate();
      toast.success("Date restored.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setCapacity = useMutation({
    mutationFn: (vars: { sessionId: string; capacity: number | null }) =>
      call(() =>
        supabase.rpc("admin_set_session_capacity", {
          p_session_id: vars.sessionId,
          p_capacity: vars.capacity as number,
        }),
      ),
    onSuccess: (result) => {
      invalidate();
      if (result.over_capacity) {
        toast.warning("Saved, but this date is already over the capacity you set.");
      } else {
        toast.success("Capacity saved.");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createSocial = useMutation({
    mutationFn: (vars: {
      cityId: string;
      date: string;
      productId: string;
      variantIds: string[];
      capacity?: number | null;
      label?: string | null;
    }) =>
      call(() =>
        supabase.rpc("admin_create_social_occurrence", {
          p_city_id: vars.cityId,
          p_date: vars.date,
          p_shopify_product_id: vars.productId,
          p_variant_ids: vars.variantIds,
          p_capacity: (vars.capacity ?? undefined) as number,
          p_label: vars.label ?? undefined,
        }),
      ),
    onSuccess: (result) => {
      invalidate();
      toast.success(
        result.reused_session
          ? "Linked the ticket types to the existing draft Social for that date."
          : "Social occurrence created as a draft.",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return { reconcile, setScheduleActive, skipDate, unskipDate, setCapacity, createSocial };
}

/** Pin a session so every admin screen works against exactly this date. */
export function pinSession(sessionId: string) {
  localStorage.setItem("gp_session_id", sessionId);
}
