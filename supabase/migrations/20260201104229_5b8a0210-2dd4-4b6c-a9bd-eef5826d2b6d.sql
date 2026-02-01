-- Add unique constraint on feedback(court_id, player_id) to enforce one feedback per player per court
ALTER TABLE public.feedback 
ADD CONSTRAINT feedback_court_player_unique UNIQUE (court_id, player_id);