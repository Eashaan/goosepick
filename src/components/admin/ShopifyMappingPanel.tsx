import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Link2,
  Loader2,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ActiveSession } from "@/hooks/useActiveSession";
import {
  findAttachableMapping,
  useSessionMappings,
  useShopifyMappingMutations,
  useUnmappedRegistrations,
  useWebhookAttentionEvents,
  type ShopifyMappingRow,
  type UnmappedRegistrationRow,
  type VariantSelection,
  type WebhookAttentionRow,
} from "@/hooks/useShopifyMappings";
import {
  STOREFRONT_SESSION_KEY_PROPERTY,
  describeUnmappedReason,
  describeVariant,
  eventProductsForType,
  normalizeShopifyId,
  type GoosepickEventType,
  type ShopifyEventProduct,
} from "@/lib/shopifyCatalog";

export const SHOPIFY_PANEL_ANCHOR = "shopify-tickets";

const selectionKey = (productId: string, variantId: string | null) =>
  `${productId}:${variantId ?? "all"}`;

const mappingSelectionKey = (m: ShopifyMappingRow) =>
  selectionKey(normalizeShopifyId(m.shopify_product_id) ?? m.shopify_product_id, normalizeShopifyId(m.shopify_variant_id));

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const copyText = async (value: string, label: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy — select the text and copy it manually");
  }
};

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "Something went wrong";

/**
 * Red strip for the top of the admin dashboard: paid seats with no session
 * are the one thing that must never go unnoticed.
 */
export const UnmappedSeatsBanner = () => {
  const { data: unmapped = [] } = useUnmappedRegistrations();
  if (unmapped.length === 0) return null;
  return (
    <a
      href={`#${SHOPIFY_PANEL_ANCHOR}`}
      className="mb-4 flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
      data-testid="unmapped-seats-banner"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      <span>
        <span className="font-semibold">{unmapped.length} paid Shopify {unmapped.length === 1 ? "seat isn't" : "seats aren't"} linked to any session.</span>{" "}
        <span className="text-muted-foreground">Open Shopify tickets below to attach them.</span>
      </span>
    </a>
  );
};

interface ShopifyMappingPanelProps {
  session: ActiveSession | null;
  isEnded: boolean;
  /** Selected venue name — used only to pre-tick Thursdays variants for that venue. */
  locationName?: string | null;
}

/**
 * Session ↔ Shopify product/variant links ("occurrence mappings"). Lives on
 * the existing admin dashboard; the webhook only ever trusts these rows plus
 * the key the storefront sends — never product titles.
 */
const ShopifyMappingPanel = ({ session, isEnded, locationName = null }: ShopifyMappingPanelProps) => {
  const sessionId = session?.id ?? null;
  const { data: mappings = [], isLoading: mappingsLoading, isError: mappingsError } = useSessionMappings(sessionId);
  const { data: unmapped = [] } = useUnmappedRegistrations();
  const { data: attention = [] } = useWebhookAttentionEvents();
  const { create, setActive, remove, resolveUnmapped } = useShopifyMappingMutations(sessionId);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customVariant, setCustomVariant] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const products = useMemo<ShopifyEventProduct[]>(
    () => (session ? eventProductsForType(session.event_type as GoosepickEventType) : []),
    [session],
  );
  const mappedKeys = useMemo(() => new Set(mappings.map(mappingSelectionKey)), [mappings]);
  const occurrenceKey = mappings.find((m) => m.occurrence_key)?.occurrence_key ?? null;
  const activeCount = mappings.filter((m) => m.is_active).length;

  // Auto-open when something needs attention.
  useEffect(() => {
    if (unmapped.length > 0 || attention.length > 0) setOpen(true);
  }, [unmapped.length, attention.length]);

  // Pre-tick unmapped variants once per session: all Social variants, or the
  // Thursdays variants for the selected venue.
  useEffect(() => {
    if (!session || mappingsLoading || seededFor === session.id) return;
    const next = new Set<string>();
    for (const product of products) {
      for (const variant of product.variants) {
        const key = selectionKey(product.productId, variant.variantId);
        if (mappedKeys.has(key)) continue;
        const venueMatch =
          !variant.venue ||
          (locationName ? locationName.toLowerCase().includes(variant.venue.toLowerCase()) : false);
        if (venueMatch) next.add(key);
      }
    }
    setSelected(next);
    setSeededFor(session.id);
  }, [session, products, mappedKeys, mappingsLoading, seededFor, locationName]);

  if (!session) return null;

  const toggle = (key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleLink = async () => {
    const selections: VariantSelection[] = [];
    for (const key of selected) {
      const [productId, variant] = key.split(":");
      selections.push({ productId, variantId: variant === "all" ? null : variant });
    }
    const custom = normalizeShopifyId(customVariant);
    if (customVariant.trim() && !custom) {
      toast.error("Custom variant id must be numeric or a gid://shopify/ProductVariant/… id");
      return;
    }
    if (custom) {
      const product = products[0];
      if (!product) return;
      selections.push({ productId: product.productId, variantId: custom });
    }
    if (selections.length === 0) {
      toast.error("Pick at least one variant to link");
      return;
    }
    try {
      const result = await create.mutateAsync({ session, selections, occurrenceKey });
      setSelected(new Set());
      setCustomVariant("");
      if (result.created > 0) toast.success(`Linked ${result.created} variant${result.created === 1 ? "" : "s"} to this session`);
      if (result.skippedExisting > 0) toast.info(`${result.skippedExisting} already linked`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleAttach = async (seat: UnmappedRegistrationRow, mapping: ShopifyMappingRow) => {
    try {
      await resolveUnmapped.mutateAsync({ registrationId: seat.id, mappingId: mapping.id });
      toast.success(`Seat ${seat.seat_index} attached to this session`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const unmappedForThisType = unmapped.filter((seat) =>
    products.some((p) => p.productId === normalizeShopifyId(seat.shopify_product_id)),
  );
  const unmappedOther = unmapped.length - unmappedForThisType.length;

  return (
    <div
      id={SHOPIFY_PANEL_ANCHOR}
      className="rounded-xl border border-border bg-card p-4"
      data-testid="shopify-mapping-panel"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Shopify tickets</p>
              {unmapped.length > 0 && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive-foreground">
                  {unmapped.length} unlinked
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {mappingsLoading
                ? "Loading…"
                : mappingsError
                  ? "Couldn't load links"
                  : activeCount === 0
                    ? "Not linked to Shopify yet — paid tickets won't reach this session"
                    : `${activeCount} variant${activeCount === 1 ? "" : "s"} linked · key ${occurrenceKey ?? "—"}`}
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="mt-4 space-y-5">
          {/* Unlinked paid seats */}
          {unmapped.length > 0 && (
            <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="unmapped-seats">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-sm font-semibold">Paid seats waiting for a session</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The storefront didn't send a usable session key for these. Attach each seat to this session once the matching variant is linked below.
                {unmappedOther > 0 && ` ${unmappedOther} more belong to a different event type — open that event's dashboard.`}
              </p>
              <ul className="mt-3 space-y-2">
                {unmappedForThisType.map((seat) => {
                  const target = findAttachableMapping(seat, mappings);
                  const label = seat.line_item_title ?? describeVariant(seat.shopify_product_id, seat.shopify_variant_id);
                  return (
                    <li key={seat.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {label} · seat {seat.seat_index}
                          {seat.line_item_quantity && seat.line_item_quantity > 1 ? ` of ${seat.line_item_quantity}` : ""}
                        </p>
                        <p className="truncate text-muted-foreground">
                          {seat.commerce_order?.shopify_order_name ?? "Order"} · {seat.commerce_order?.purchaser_email ?? seat.participant_email ?? "no email"} · {describeUnmappedReason(seat.unmapped_reason)}
                          {seat.requested_session_key ? ` (sent: ${seat.requested_session_key})` : ""}
                        </p>
                      </div>
                      {isEnded ? (
                        <span className="text-muted-foreground">Session ended</span>
                      ) : target ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolveUnmapped.isPending}
                          onClick={() => handleAttach(seat, target)}
                        >
                          {resolveUnmapped.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
                          Attach to this session
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">Link {describeVariant(seat.shopify_product_id, seat.shopify_variant_id)} below first</span>
                      )}
                    </li>
                  );
                })}
                {unmappedForThisType.length === 0 && (
                  <li className="text-xs text-muted-foreground">None for this event type.</li>
                )}
              </ul>
            </section>
          )}

          {/* Occurrence key + storefront instructions */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Session key for the storefront</p>
            {occurrenceKey ? (
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-secondary px-3 py-2 font-mono text-xs" data-testid="occurrence-key">{occurrenceKey}</code>
                <Button variant="outline" size="sm" onClick={() => copyText(occurrenceKey, "Session key")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Generated when you link the first variant.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Checkout must attach the line item property{" "}
              <code className="rounded bg-secondary px-1 font-mono">{STOREFRONT_SESSION_KEY_PROPERTY}</code> with this exact value to every ticket for this session. Tickets without it arrive as "waiting for a session" above — never guessed. Full contract:{" "}
              <code className="rounded bg-secondary px-1 font-mono">docs/SHOPIFY_EXPERIENCE_INTEGRATION.md</code>.
            </p>
          </section>

          {/* Linked variants */}
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked variants</p>
            {mappings.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Nothing linked yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {mappings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs" data-testid="linked-variant">
                    <div className="min-w-0">
                      <p className={`truncate font-medium ${m.is_active ? "" : "text-muted-foreground line-through"}`}>
                        {describeVariant(m.shopify_product_id, m.shopify_variant_id)}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{m.mapping_key}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Switch
                        checked={m.is_active}
                        disabled={isEnded || setActive.isPending}
                        onCheckedChange={(on) =>
                          setActive.mutate({ id: m.id, isActive: on }, { onError: (err) => toast.error(errorMessage(err)) })
                        }
                        aria-label={`${m.is_active ? "Disable" : "Enable"} ${describeVariant(m.shopify_product_id, m.shopify_variant_id)}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={isEnded || remove.isPending}
                        aria-label="Remove link"
                        onClick={() =>
                          remove.mutate(m.id, {
                            onSuccess: () => toast.success("Link removed"),
                            onError: (err) => toast.error(errorMessage(err)),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Add variants */}
          {!isEnded && products.length > 0 && (
            <section data-testid="add-variants">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link variants to this session</p>
              {products.map((product) => (
                <div key={product.productId} className="mt-2">
                  <p className="text-xs font-medium">{product.title}</p>
                  {product.eventType === "thursdays" && (
                    <p className="text-[11px] text-muted-foreground">Thursdays variants encode venue + skill level — link only this venue's variants.</p>
                  )}
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {product.variants.map((variant) => {
                      const key = selectionKey(product.productId, variant.variantId);
                      const already = mappedKeys.has(key);
                      return (
                        <label
                          key={variant.variantId}
                          className={`flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs ${already ? "opacity-60" : "cursor-pointer"}`}
                        >
                          <Checkbox
                            checked={already || selected.has(key)}
                            disabled={already}
                            onCheckedChange={(on) => toggle(key, on === true)}
                            aria-label={variant.title}
                          />
                          <span className="truncate">{variant.title}</span>
                          {already && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={customVariant}
                  onChange={(e) => setCustomVariant(e.target.value)}
                  placeholder="Other variant id (numeric or gid://…)"
                  className="text-xs"
                />
                <Button onClick={handleLink} disabled={create.isPending} className="shrink-0">
                  {create.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
                  Link selected
                </Button>
              </div>
            </section>
          )}

          {/* Webhook events needing attention */}
          {attention.length > 0 && <AttentionList events={attention} />}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

const noteFor = (event: WebhookAttentionRow): string => {
  const result = (event.result ?? {}) as Record<string, unknown>;
  if (event.error) return event.error;
  if (typeof result.note === "string") return result.note;
  if (typeof result.reason === "string") return String(result.reason).replace(/_/g, " ");
  if (typeof result.unmapped_seats === "number" && result.unmapped_seats > 0) return `${result.unmapped_seats} seat(s) could not be matched to a session`;
  return "Needs a look";
};

const AttentionList = ({ events }: { events: WebhookAttentionRow[] }) => (
  <section data-testid="webhook-attention">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shopify events needing attention</p>
    <ul className="mt-2 space-y-1.5">
      {events.map((event) => (
        <li key={event.id} className="rounded-md bg-secondary px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {event.topic}
              {event.shopify_order_id ? ` · order ${event.shopify_order_id}` : ""}
            </span>
            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${event.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
              {event.status.replace("_", " ")} · {formatWhen(event.created_at)}
            </span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{noteFor(event)}</p>
        </li>
      ))}
    </ul>
  </section>
);

export default ShopifyMappingPanel;
