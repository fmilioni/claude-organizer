-- OR-recall search (CO-239). Built on websearch_to_tsquery (so arbitrary user
-- input never raises a syntax error), splitting its `&`-joined output into the
-- positive terms and the `-exclude` negations.
--
-- or_tsquery: the positive terms OR-ed (a record matching ANY term hits, not only
-- one matching all). Negations are dropped here — exclusion is enforced by the
-- separate NOT guard below, so it also covers the substring/typo (ILIKE/`<%`)
-- recall branches, not just full-text.
CREATE OR REPLACE FUNCTION or_tsquery(config regconfig, q text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    string_agg(part, ' | ') FILTER (WHERE left(part, 1) <> '!'),
    ''
  )::tsquery
  FROM (
    SELECT btrim(p) AS part
    FROM unnest(
      string_to_array(websearch_to_tsquery(config, q)::text, ' & ')
    ) AS p
  ) t
  WHERE part <> ''
$$;
--> statement-breakpoint
-- excluded_tsquery: the `-exclude` terms (websearch `!term`) as a plain OR-ed
-- tsquery, empty when the query has no negation. Used as `NOT (tsv @@ …)` so an
-- excluded row is dropped regardless of which recall branch matched it.
CREATE OR REPLACE FUNCTION excluded_tsquery(config regconfig, q text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    string_agg(ltrim(part, '!'), ' | ') FILTER (WHERE left(part, 1) = '!'),
    ''
  )::tsquery
  FROM (
    SELECT btrim(p) AS part
    FROM unnest(
      string_to_array(websearch_to_tsquery(config, q)::text, ' & ')
    ) AS p
  ) t
  WHERE part <> ''
$$;
--> statement-breakpoint
-- CO-239 extends the substring/typo recall (ILIKE + pg_trgm `<%`) over the body
-- columns; without a trigram index the OR fallback seq-scans the full markdown.
-- Reverses the earlier "body out of the trigram index" trade-off (docs/cards ADRs).
CREATE INDEX "docs_body_md_trgm_idx" ON "docs" USING gin ("body_md" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_description_md_trgm_idx" ON "cards" USING gin ("description_md" gin_trgm_ops);
