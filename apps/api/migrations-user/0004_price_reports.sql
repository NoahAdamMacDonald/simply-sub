-- M10.10 (BLUEPRINT §5.4, §14): "Report a wrong price", counted until the nightly clean-up hands the counts to the
-- bot's KV. A row per plan, country, problem and price (the price's fields as JSON in one order, '' for a report
-- without one), with how many came and the first and last day. Nothing about who sent them: no IP address, no time.

CREATE TABLE price_reports (
  plan TEXT NOT NULL,
  country TEXT NOT NULL,
  problem TEXT NOT NULL,
  price TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  PRIMARY KEY (plan, country, problem, price)
) STRICT, WITHOUT ROWID;
