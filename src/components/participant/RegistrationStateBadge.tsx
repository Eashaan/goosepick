import {
  REGISTRATION_STATE_LABEL,
  type DerivedRegistrationState,
} from "@/integrations/supabase/participantDb";

const stateTone: Record<DerivedRegistrationState, string> = {
  profile_required: "bg-secondary text-foreground",
  roster_pending: "bg-secondary text-muted-foreground",
  roster_ready: "bg-primary/15 text-primary",
  live: "bg-primary text-primary-foreground",
  completed: "bg-secondary text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-muted text-muted-foreground",
  unmapped: "bg-secondary text-muted-foreground",
};

const RegistrationStateBadge = ({ state }: { state: DerivedRegistrationState }) => (
  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${stateTone[state]}`}>
    {REGISTRATION_STATE_LABEL[state]}
  </span>
);

export default RegistrationStateBadge;
