/**
 * Curated names for instruments creators name without saying the ticker.
 *
 * US equities list only aliases: the ticker, legal name and exchange come from
 * the SEC snapshot, and tests/listing-resolution.test.ts fails if a ticker here
 * is missing from it. Everything the SEC file does not cover (ETFs it omits,
 * crypto, indices, commodities, rates, non-US listings, private companies) is a
 * full entry and is marked `curated` wherever it is shown.
 *
 * Rules: an alias must name one instrument. Never map a sector, an index or a
 * theme to an ETF ("Nasdaq" is not QQQ). Leave out any name that is ambiguous
 * (超微 is both AMD and Super Micro in Chinese usage; bare "Nasdaq" is two
 * indices). Chinese aliases are listed in Simplified and Traditional forms.
 */
export type Market =
  | "us-stock"
  | "us-etf"
  | "crypto"
  | "index"
  | "commodity"
  | "rates"
  | "fx"
  | "ca"
  | "hk"
  | "kr"
  | "private";

/** SEC-listed ticker → aliases a creator may say instead. */
export const US_ALIASES: Record<string, string[]> = {
  AAPL: ["Apple", "苹果", "蘋果"],
  MSFT: ["Microsoft", "微软", "微軟"],
  GOOGL: ["Google", "Alphabet", "谷歌", "谷歌母公司"],
  AMZN: ["Amazon", "亚马逊", "亞馬遜"],
  META: ["Meta", "Facebook", "脸书", "臉書"],
  NVDA: ["Nvidia", "英伟达", "英偉達", "辉达", "輝達"],
  TSLA: ["Tesla", "特斯拉"],
  AVGO: ["Broadcom", "博通"],
  TSM: ["TSMC", "Taiwan Semiconductor", "台积电", "台積電"],
  AMD: ["Advanced Micro Devices"],
  INTC: ["Intel", "英特尔", "英特爾"],
  QCOM: ["Qualcomm", "高通"],
  MU: ["Micron", "美光", "美光科技", "美光半导体", "美光半導體"],
  ARM: ["Arm Holdings"],
  ASML: ["阿斯麦", "阿斯麥"],
  SMCI: ["Supermicro", "Super Micro"],
  SNDK: ["Sandisk", "闪迪", "閃迪"],
  ORCL: ["Oracle", "甲骨文"],
  ADBE: ["Adobe"],
  CRM: ["Salesforce"],
  NOW: ["ServiceNow", "Service Now"],
  PLTR: ["Palantir", "Palantir Technologies", "Palanteer", "Palunteer", "帕兰提尔", "帕蘭提爾"],
  NFLX: ["Netflix", "奈飞", "奈飛", "网飞", "網飛"],
  UBER: ["Uber"],
  COIN: ["Coinbase"],
  HOOD: ["Robinhood"],
  MSTR: ["MicroStrategy", "微策略"],
  CRWV: ["CoreWeave", "Cororeweave"],
  NBIS: ["Nebius"],
  COHR: ["Coherent"],
  LITE: ["Lumentum", "Lumenum"],
  CRDO: ["Credo", "Credo Technology"],
  ONDS: ["Ondas", "Ondas Holdings"],
  IONQ: ["IonQ"],
  HIMS: ["Hims", "Hims and Hers", "Hims & Hers", "Him and Hers"],
  SOFI: ["SoFi", "SoFi Technologies"],
  ELF: ["e.l.f.", "e.l.f. Beauty", "Elf Beauty", "E.L.F."],
  CELH: ["Celsius", "Celsius Holdings"],
  WYNN: ["Wynn", "Wynn Resorts", "Win Resorts", "Winning Resorts"],
  AXP: ["American Express", "Amex", "美国运通", "美國運通"],
  NKE: ["Nike", "耐克"],
  MDB: ["MongoDB"],
  AVAV: ["AeroVironment"],
  RH: ["Restoration Hardware"],
  LLY: ["Eli Lilly", "Lilly", "礼来", "禮來"],
  NVO: ["Novo Nordisk", "诺和诺德", "諾和諾德"],
  MCD: ["McDonald's", "McDonalds", "麦当劳", "麥當勞"],
  BA: ["Boeing", "波音"],
  APO: ["Apollo Global", "Apollo Global Management"],
  BAC: ["Bank of America", "美国银行", "美國銀行", "美银", "美銀"],
  WFC: ["Wells Fargo", "富国银行", "富國銀行"],
  JPM: ["JPMorgan", "JP Morgan", "JPMorgan Chase", "摩根大通"],
  GS: ["Goldman Sachs", "高盛"],
  MS: ["Morgan Stanley", "摩根士丹利"],
  "BRK-B": ["Berkshire", "Berkshire Hathaway", "伯克希尔", "伯克希爾"],
  BABA: ["Alibaba", "阿里巴巴", "阿里"],
  PDD: ["Pinduoduo", "Temu", "拼多多"],
  JD: ["JD.com", "京东", "京東"],
  BIDU: ["Baidu", "百度"],
  NIO: ["蔚来", "蔚來"],
  XPEV: ["XPeng", "小鹏", "小鵬"],
  LI: ["Li Auto", "理想汽车", "理想汽車"],
  WMT: ["Walmart", "沃尔玛", "沃爾瑪"],
  COST: ["Costco", "好市多", "开市客", "開市客"],
  KO: ["Coca-Cola", "可口可乐", "可口可樂"],
  DIS: ["Disney", "迪士尼"],
  V: ["Visa"],
  MA: ["Mastercard"],
  UNH: ["UnitedHealth", "联合健康", "聯合健康"],
  GME: ["GameStop", "游戏驿站", "遊戲驛站"],
  RKT: ["Rocket Companies", "Rocket Mortgage"],
  MOD: ["Modine"],
  STRL: ["Sterling Infrastructure"],
  LGN: ["Legence"],
  SSRM: ["SSR Mining"],
  NEWP: ["New Pacific Metals", "New Pacific"],
  MUX: ["McEwen Mining", "McEwen"],
  SPY: ["SPDR S&P 500 ETF"],
};

export type CuratedListing = {
  symbol: string | null;
  name: string;
  market: Market;
  exchange: string | null;
  aliases: string[];
};

/** Instruments the SEC snapshot does not cover. */
export const CURATED: CuratedListing[] = [
  // ETFs (named by ticker or fund name only, never inferred from an index).
  { symbol: "QQQ", name: "Invesco QQQ Trust", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "GLD", name: "SPDR Gold Shares", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "SLV", name: "iShares Silver Trust", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "GDX", name: "VanEck Gold Miners ETF", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "GDXJ", name: "VanEck Junior Gold Miners ETF", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "USO", name: "United States Oil Fund", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "GSG", name: "iShares S&P GSCI Commodity-Indexed Trust", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "SOXX", name: "iShares Semiconductor ETF", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "XLE", name: "Energy Select Sector SPDR Fund", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "XLF", name: "Financial Select Sector SPDR Fund", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "KRE", name: "SPDR S&P Regional Banking ETF", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  { symbol: "TQQQ", name: "ProShares UltraPro QQQ", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "SQQQ", name: "ProShares UltraPro Short QQQ", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "IBIT", name: "iShares Bitcoin Trust", market: "us-etf", exchange: "Nasdaq", aliases: [] },
  { symbol: "ARKK", name: "ARK Innovation ETF", market: "us-etf", exchange: "NYSE Arca", aliases: [] },
  // Crypto.
  { symbol: "BTC", name: "Bitcoin", market: "crypto", exchange: null, aliases: ["Bitcoin", "比特币", "比特幣"] },
  { symbol: "ETH", name: "Ethereum", market: "crypto", exchange: null, aliases: ["Ethereum", "Ether", "以太坊", "以太币", "以太幣"] },
  { symbol: "SOL", name: "Solana", market: "crypto", exchange: null, aliases: ["Solana"] },
  { symbol: "HYPE", name: "Hyperliquid", market: "crypto", exchange: null, aliases: ["Hyperliquid"] },
  { symbol: "ZEC", name: "Zcash", market: "crypto", exchange: null, aliases: ["Zcash"] },
  { symbol: "XRP", name: "XRP", market: "crypto", exchange: null, aliases: ["Ripple"] },
  { symbol: "DOGE", name: "Dogecoin", market: "crypto", exchange: null, aliases: ["Dogecoin", "狗狗币", "狗狗幣"] },
  // Indices: named exactly; bare "Nasdaq" is ambiguous and left out.
  { symbol: "SPX", name: "S&P 500 index", market: "index", exchange: null, aliases: ["S&P 500", "S&P", "SPX", "标普500", "標普500", "标普500指数", "標普500指數", "标普", "標普"] },
  { symbol: "NDX", name: "Nasdaq-100 index", market: "index", exchange: null, aliases: ["Nasdaq 100", "Nasdaq-100", "纳斯达克100", "納斯達克100", "纳指100", "納指100"] },
  { symbol: "IXIC", name: "Nasdaq Composite index", market: "index", exchange: null, aliases: ["Nasdaq Composite", "纳斯达克综合指数", "納斯達克綜合指數"] },
  { symbol: "DJI", name: "Dow Jones Industrial Average", market: "index", exchange: null, aliases: ["Dow Jones", "Dow Jones Industrial Average", "道琼斯", "道瓊斯", "道指"] },
  { symbol: "RUT", name: "Russell 2000 index", market: "index", exchange: null, aliases: ["Russell 2000", "罗素2000", "羅素2000"] },
  { symbol: "SOX", name: "PHLX Semiconductor index", market: "index", exchange: null, aliases: ["Philadelphia Semiconductor Index", "费城半导体指数", "費城半導體指數", "费半", "費半"] },
  { symbol: "VIX", name: "Cboe Volatility Index", market: "index", exchange: null, aliases: ["VIX", "波动率指数", "波動率指數", "波动率指数VIX", "恐慌指数", "恐慌指數"] },
  // Commodities, rates and currencies, as the asset rather than any fund.
  { symbol: "GOLD", name: "Gold", market: "commodity", exchange: null, aliases: ["gold", "spot gold", "黄金", "黃金", "现货黄金", "現貨黃金"] },
  { symbol: "SILVER", name: "Silver", market: "commodity", exchange: null, aliases: ["silver", "spot silver", "白银", "白銀"] },
  { symbol: "OIL", name: "Crude oil", market: "commodity", exchange: null, aliases: ["oil", "crude", "crude oil", "原油", "石油"] },
  { symbol: "NATGAS", name: "Natural gas", market: "commodity", exchange: null, aliases: ["natural gas", "天然气", "天然氣"] },
  { symbol: "COPPER", name: "Copper", market: "commodity", exchange: null, aliases: ["copper", "铜", "銅"] },
  { symbol: "UST", name: "US Treasuries", market: "rates", exchange: null, aliases: ["Treasuries", "US Treasuries", "US bonds", "美债", "美債", "美国国债", "美國國債"] },
  { symbol: "USD", name: "US dollar", market: "fx", exchange: null, aliases: ["dollar", "US dollar", "DXY", "美元", "美元指数", "美元指數"] },
  // Non-US listings (curated; not registry-verified).
  { symbol: "LUN", name: "Lundin Mining", market: "ca", exchange: "TSX", aliases: ["Lundin Mining"] },
  { symbol: "GGD", name: "GoGold Resources", market: "ca", exchange: "TSX", aliases: ["GoGold", "GoGold Resources"] },
  { symbol: "BYN", name: "Banyan Gold", market: "ca", exchange: "TSXV", aliases: ["Banyan", "Banyan Gold"] },
  { symbol: "CBR", name: "Cabral Gold", market: "ca", exchange: "TSXV", aliases: ["Cabral", "Cabral Gold"] },
  { symbol: "AUMB", name: "1911 Gold", market: "ca", exchange: "TSXV", aliases: ["1911 Gold"] },
  { symbol: "NEXG", name: "NexGold Mining", market: "ca", exchange: "TSXV", aliases: ["NexGold", "NexGold Mining", "Next Gold Mining"] },
  { symbol: "ARTG", name: "Artemis Gold", market: "ca", exchange: null, aliases: ["Artemis Gold"] },
  { symbol: "0700.HK", name: "Tencent", market: "hk", exchange: "HKEX", aliases: ["Tencent", "腾讯", "騰訊"] },
  { symbol: "1810.HK", name: "Xiaomi", market: "hk", exchange: "HKEX", aliases: ["Xiaomi", "小米"] },
  { symbol: "1211.HK", name: "BYD", market: "hk", exchange: "HKEX", aliases: ["BYD", "比亚迪", "比亞迪"] },
  { symbol: "3690.HK", name: "Meituan", market: "hk", exchange: "HKEX", aliases: ["Meituan", "美团", "美團"] },
  { symbol: "000660.KS", name: "SK hynix", market: "kr", exchange: "KRX", aliases: ["SK hynix", "SK Hynix", "SK海力士"] },
  // Private companies: identified, never priced.
  { symbol: null, name: "Anthropic", market: "private", exchange: null, aliases: ["Anthropic"] },
  { symbol: null, name: "OpenAI", market: "private", exchange: null, aliases: ["OpenAI"] },
  { symbol: null, name: "SpaceX", market: "private", exchange: null, aliases: ["SpaceX"] },
  { symbol: null, name: "Waymo", market: "private", exchange: null, aliases: ["Waymo"] },
  { symbol: null, name: "xAI", market: "private", exchange: null, aliases: ["xAI"] },
];
