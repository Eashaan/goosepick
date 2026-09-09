ALTER TABLE public.experience_registrations
  ADD COLUMN IF NOT EXISTS selected_skill_level text;

COMMENT ON COLUMN public.experience_registrations.selected_skill_level IS
  'Advisory skill level chosen by the customer at checkout (line item property _goosepick_skill_level). Never used to place a player on a court or group.';