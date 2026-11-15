export function headlineKey(story) {
  if (story.filingDate && story.url) return "filing:" + story.url;
  return story.headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function uniqueHeadlines(stories, excluded = []) {
  const seen = new Set(excluded.map(headlineKey));
  return stories.filter(story => {
    const key = headlineKey(story);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function groupNewsEvents(entries) {
  const groups = [];
  const ignored = new Set(["about", "after", "from", "have", "into", "market", "over", "says", "stocks", "that", "their", "this", "with"]);
  const words = headline => new Set(headlineKey({ headline }).split(" ").filter(word => word.length >= 4 && !ignored.has(word)));
  for (const entry of entries) {
    const key = headlineKey(entry.story);
    const tokens = words(entry.story.headline);
    const group = groups.find(({ lead, leadKey, leadWords }) => {
      if (leadKey === key || (entry.story.url && lead.story.url === entry.story.url)) return true;
      if (entry.story.filingDate || lead.story.filingDate || lead.reason !== entry.reason ||
          Math.abs(lead.story.timestamp - entry.story.timestamp) > 12 * 3600000) return false;
      const overlap = [...tokens].filter(word => leadWords.has(word)).length;
      return overlap >= 4 && overlap / (tokens.size + leadWords.size - overlap) >= 0.55;
    });
    if (group) {
      if (entry.story.url && entry.story.url !== group.lead.story.url &&
          !group.coverage.some(row => row.url === entry.story.url)) group.coverage.push(entry.story);
    } else groups.push({ lead: entry, leadKey: key, leadWords: tokens, coverage: [] });
  }
  return groups;
}

export function distinguishFilings(filings) {
  const counts = new Map();
  for (const { headline, filingDate } of filings) {
    const key = filingDate + ":" + headline;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return filings.map(filing => (counts.get(filing.filingDate + ":" + filing.headline) ?? 0) > 1
    ? { ...filing, headline: filing.headline + " · " + filing.accession } : filing);
}



export function newsPercentageTone(text, index, length) {
  const boundary = /[;!?]|\.\s|,\s|\b(?:but|while|whereas|however)\b/i;
  const left = text.slice(0, index).split(boundary).at(-1);
  const right = text.slice(index + length).split(boundary)[0];
  const clause = left + " " + right;
  if (/\b(?:could|may|might|would|proposed|proposal|rumou?rs?|forecast(?:s|ed)?|expected|projected|chance|odds|if)\b/i.test(clause) ||
      /\?\s*$/.test(text) || /^\s+of\b/i.test(right)) return "neutral";

  const rising = "ris(?:e|es|en|ing)|rose|up|higher|climb(?:s|ed)?|gain(?:s|ed)?|jump(?:s|ed)?|surge(?:s|d)?|soar(?:s|ed)?|rall(?:y|ies|ied)|increas(?:e|es|ed)|hik(?:e|es|ed)|rais(?:e|es|ed)";
  const falling = "fall(?:s|en|ing)?|fell|down|lower|drop(?:s|ped)?|plung(?:e|es|ed)|crash(?:es|ed)?|declin(?:e|es|ed)|slid(?:e|es)?|cut(?:s)?|reduc(?:e|es|ed)|decreas(?:e|es|ed)";
  const direction = left.match(new RegExp("\\b(" + rising + "|" + falling + ")\\b\\s*(?:(?:sharply|roughly|nearly|about|as much as)\\s+)?(?:(?:by|to)\\s+)?$", "i"))?.[1] ??
    right.match(new RegExp("^\\s+(?:percentage points?\\s+)?(" + rising + "|" + falling + ")\\b", "i"))?.[1];
  const sided = direction ? (new RegExp("^(?:" + rising + ")$", "i").test(direction) ? 1 : -1) : 0;

  const tariff = /\b(?:tariffs?|import duties|import levies)\b/i;
  const adverseMetric = /\b(?:tariffs?|import duties|import levies|inflation|consumer prices?|unemployment|jobless rate|(?:fuel|gasoline|diesel|oil|energy) prices?|borrowing costs?)\b/i;
  const marketMetric = /\b(?:shares?|stocks?|stock prices?|equities|markets?|bitcoin|btc|ethereum|eth|solana|crypto(?:currency)?|revenue|sales|profits?|earnings)\b/i;
  const subject = new RegExp(adverseMetric.source + "|" + marketMetric.source, "gi");
  const after = right.match(new RegExp("^\\s*(?:(?:new|higher|lower|retaliatory)\\s+)?(" + adverseMetric.source + "|" + marketMetric.source + ")", "i"))?.[1];
  const metric = after ?? [...left.matchAll(subject)].at(-1)?.[0];
  if (!metric) return "neutral";

  if (tariff.test(metric)) {
    if (/\b(?:cut(?:s)?|slash(?:es|ed)?|reduc(?:e|es|ed)|lower(?:s|ed)?|cancel(?:s|ed|led)?|lift(?:s|ed)?|remove[sd]?|blocks?|blocked)\b/i.test(clause) &&
        !/\b(?:raises?|raised|hikes?|hiked|increase[sd]?|retaliat\w*)\b/i.test(clause)) return "gain";
    if (/\b(?:new|higher|retaliat\w*|impos\w*|announc\w*|enact\w*|take(?:s|n)? effect|in effect|effective|raises?|raised|hikes?|hiked|increase[sd]?)\b/i.test(clause)) return "loss";
  }
  if (!sided) return "neutral";
  return (adverseMetric.test(metric) ? -sided : sided) > 0 ? "gain" : "loss";
}

export function governmentRiskReason(headline) {
  if (/\b(?:tariffs?|trade war|trade sanctions|export controls?|import duties)\b/i.test(headline)) {
    return "Tariffs or trade restrictions";
  }
  const fuel = /\b(?:oil|crude|fuel|gasoline|diesel|natural gas|energy prices?|refiner\w*|hormuz)\b/i.test(headline);
  if (fuel && /\b(?:shortages?|disrupt\w*|blockad\w*|shut\w*|outages?|spikes?|surges?|soars?|supply cuts?|higher prices|rising prices)\b/i.test(headline)) {
    return "Fuel prices or supply disruption";
  }
  if (/\b(?:talks? of war|war fears?|war threats?|threat\w* (?:of )?war|military (?:escalat\w*|action|strikes?|threats?)|airstrikes?|missile strikes?|invasion|armed conflict|conflict escalat\w*)\b/i.test(headline)) {
    return "War or geopolitical risk";
  }
  if (/\b(?:inflation|consumer prices?|cpi|cost of living)\b/i.test(headline) &&
      /\b(?:rises?|rose|higher|hotter|accelerat\w*|surges?|spikes?|unexpected\w*|above forecasts?|sticky|persistent)\b/i.test(headline)) {
    return "Inflation or household cost pressure";
  }
  if (/\b(?:law|laws|bill|legislation|regulations?|executive orders?|government shutdown|tax policy|budget cuts?)\b/i.test(headline) &&
      /\b(?:costs?|tax hikes?|higher taxes|higher bills|higher prices|job losses|layoffs?|cuts? benefits|cuts? spending|households?|consumers?|small businesses|economic slowdown)\b/i.test(headline)) {
    return "Policy with reported economic impact";
  }
  return null;
}

function isMajorGovernmentRisk(headline) {
  const reason = governmentRiskReason(headline);
  if (!reason || /\b(?:could|might|rumou?rs?|opinion|editorial)\b|\?\s*$/i.test(headline)) return false;
  if (reason === "War or geopolitical risk") {
    return /\b(?:launch\w*|confirm\w*|strikes?|airstrikes?|invasion|declares?|escalat\w*)\b/i.test(headline);
  }
  if (reason === "Inflation or household cost pressure") {
    return /\b(?:unexpected\w*|hotter|above forecasts?|surges?|spikes?|accelerat\w*)\b/i.test(headline);
  }
  return /\b(?:enacts?|signed|signs?|imposes?|imposed|effective|takes? effect|closes?|closed|blocks?|blocked|halts?|halted|disrupts?|shortages?|spikes?)\b/i.test(headline);
}

export function topStories(news) {
  const groups = [
    /federal reserve|\bfed\b|interest rate|inflation|\bcpi\b|payroll|\bgdp\b|tariff/i,
    /\bs&p\b|nasdaq|dow jones|wall street|stock market|treasury yield/i,
    /\bbitcoin\b|\bethereum\b|\bcrypto\b|stablecoin/i,
    /earnings|revenue|guidance|merger|acquisition/i,
  ];
  const unique = uniqueHeadlines(news);
  const risk = unique.find(row => governmentRiskReason(row.headline));
  const picks = new Set(risk ? [risk] : []);
  for (const topic of groups) {
    const item = unique.find(row => !picks.has(row) && row.source !== "SEC EDGAR" && topic.test(row.headline));
    if (item) picks.add(item);
    if (picks.size === 3) break;
  }
  for (const item of unique) {
    if (picks.size === 3) break;
    picks.add(item);
  }
  return [...picks];
}

const criticalEventTypes = [
  [/\b(earnings|guidance|revenue forecast|profit warning)\b/i, "Earnings or outlook"],
  [/\b(merger|mergers|acquisition|acquisitions|takeover|bankruptcy|8-K)\b/i, "Company announcement or filing"],
  [/\b(hack\w*|exploit\w*|outages?|halts?|liquidat\w*)\b/i, "Market or trading disruption"],
  [/\b(lawsuits?|approvals?|bans?|regulat\w*|investigation)\b/i, "Legal or regulatory development"],
  [/\b(crash\w*|plung\w*|sell[- ]off)\b/i, "Sharp price move"],
  [/\b(federal reserve|fed|rate cuts?|rate hikes?|inflation|cpi|payrolls?|tariffs?|treasury yields?)\b/i, "Market-wide economic news"],
];

export function criticalNewsReason(headline) {
  return governmentRiskReason(headline) ?? criticalEventTypes.find(([pattern]) => pattern.test(headline))?.[1];
}

export function isMajorMarketNews(headline, matches) {
  const majorAssetEvent = /\b(bankrupt\w*|takeover|mergers?|acquisitions?|profit warning|hacks?|hacked|exploits?|exploited|trading halt|trading halted|exchange outage|liquidation wave)\b|\b(?:cut\w*|lower\w*|rais\w*|withdraw\w*|slash\w*)\b.{0,45}\b(?:guidance|revenue forecast)\b/i;
  const majorMacroEvent = /\b(?:fed|federal reserve)\b.{0,50}\b(?:cuts?|hikes?|raises?|lowers?|holds?|keeps?)\b.{0,35}\b(?:rates?|interest rate)\b|\b(?:cpi|inflation|payrolls?)\b.{0,45}\b(?:surprises?|beats?|misses?|unexpectedly)\b/i;
  const urgent = /\b(?:breaking(?: news)?|urgent|critical)\b/i.test(headline) && criticalNewsReason(headline);
  return isMajorGovernmentRisk(headline) || majorMacroEvent.test(headline) || (matches.length > 0 && Boolean(majorAssetEvent.test(headline) || urgent));
}

export function related(story, universe) {
    const tags = story.symbols.map(symbol => symbol.toUpperCase().replace(/[-/]USD$/, ""));
    const words = story.headline.match(/\b[A-Z][A-Z0-9.]{1,9}\b/g) ?? [];
    const named = { BTC: /\bbitcoin\b/i, ETH: /\bethereum\b/i, SOL: /\bsolana\b/i,
      AAPL: /\bapple\b/i, MSFT: /\bmicrosoft\b/i, TSLA: /\btesla\b/i, NVDA: /\bnvidia\b/i,
      AMD: /\badvanced micro devices\b/i, AMZN: /\bamazon\b/i, GOOGL: /\balphabet\b|\bgoogle\b/i };
    return universe.filter(row => {
      const ticker = row.symbol.split("/")[0];
      return tags.includes(ticker) || words.includes(ticker) || named[ticker]?.test(story.headline);
    });
}
