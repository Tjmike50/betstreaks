-- Enable RLS on watchlist_items
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

-- Users can view their own watchlist items
CREATE POLICY "Users can view own watchlist items"
ON public.watchlist_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own watchlist items
CREATE POLICY "Users can insert own watchlist items"
ON public.watchlist_items
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own watchlist items
CREATE POLICY "Users can delete own watchlist items"
ON public.watchlist_items
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);