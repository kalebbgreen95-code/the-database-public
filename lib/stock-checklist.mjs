const percent = value => (100 * value).toFixed(1) + "%";
const money = value => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(value);

export function stockChecklist(fundamentals, trailingPe, forwardPe, estimateIssue) {
  const growth = fundamentals?.revenueGrowth;
  const debt = fundamentals?.debtToEquity;
  const cash = fundamentals?.freeCashFlow;
  const valuation = Number.isFinite(trailingPe) && Number.isFinite(forwardPe) && trailingPe > 0 && forwardPe > 0;
  const dated = (value, date, source) => [value, date, source ?? "SEC"].filter(Boolean).join(" · ");
  return [
    ["Forward P/E below trailing P/E", valuation ? forwardPe < trailingPe : null,
      valuation ? forwardPe.toFixed(2) + "× forward / " + trailingPe.toFixed(2) + "× trailing"
        : !Number.isFinite(trailingPe) || trailingPe <= 0 ? "Positive trailing P/E unavailable"
        : estimateIssue ?? "Positive forward P/E unavailable; requires consensus EPS and a current price"],
    ["Debt-to-equity below 50%", Number.isFinite(debt) ? debt < .5 : null,
      Number.isFinite(debt) ? dated(percent(debt), fundamentals.equityDate, fundamentals.debtSource)
        : fundamentals?.fmpIssues?.debtToEquity ?? "Matching reported debt and positive equity figures unavailable"],
    ["Quarterly revenue growth above 15% year over year", Number.isFinite(growth) ? growth > .15 : null,
      Number.isFinite(growth) ? dated(percent(growth), fundamentals.revenueDate, fundamentals.revenueSource)
        : fundamentals?.fmpIssues?.revenueGrowth ?? "Comparable current and prior-year quarterly revenue unavailable"],
    ["Positive free cash flow in the last fiscal year", Number.isFinite(cash) ? cash > 0 : null,
      Number.isFinite(cash) ? dated(money(cash), fundamentals.cashDate, fundamentals.cashSource)
        : fundamentals?.fmpIssues?.freeCashFlow ?? "Matching annual operating cash flow and capital expenditure unavailable"],
  ];
}

const positivePe = value => Number.isFinite(value) && value > 0 ? value : Infinity;
const missingChecks = row => row.checks.filter(([, passed]) => passed === null).length;

const alphabetAi = "Alphabet operates Google Search, YouTube and Google Cloud. Its AI business includes Gemini models and custom TPU chips for training and running those models.";

export const aiThemes = {
  "AI memory and storage": {
    MU: "Micron makes memory chips and solid-state drives. Its high-bandwidth memory feeds AI accelerators, and its server memory and storage support AI data centers.",
    SKHY: "SK hynix makes DRAM and flash memory. Its high-bandwidth memory supplies AI accelerators with fast access to model data.",
    SNDK: "Sandisk makes flash memory and solid-state drives. Its enterprise drives store training data and model files in AI data centers.",
    WDC: "Western Digital makes hard drives. Its high-capacity drives provide bulk storage for the datasets and model archives used by AI systems.",
    STX: "Seagate makes hard drives and storage systems. Its high-capacity drives help cloud providers store large AI datasets and archives.",
  },
  "AI chips and manufacturing": {
    NVDA: "NVIDIA designs GPUs, networking hardware and computing software. Its data center GPUs and CUDA tools are used to train and run AI models.",
    AMD: "AMD designs processors and graphics chips. Its Instinct accelerators and EPYC server CPUs power AI training and inference systems.",
    AVGO: "Broadcom makes networking chips and enterprise software. It helps cloud providers design custom AI accelerators and connect large groups of AI servers.",
    TSM: "TSMC manufactures chips designed by other companies. Its advanced fabrication and packaging help produce GPUs and custom accelerators for AI.",
    ASML: "ASML makes lithography machines that print chip patterns on silicon. Its equipment enables foundries to manufacture advanced AI processors.",
    AMAT: "Applied Materials makes equipment for manufacturing chips. Its materials-processing and packaging tools are used to build AI logic chips and high-bandwidth memory.",
    LRCX: "Lam Research makes etching and deposition equipment for chip factories. Its tools help produce advanced processors and the memory that AI accelerators use.",
    KLAC: "KLA makes equipment that inspects and measures chips during manufacturing. Its tools help manufacturers find defects in advanced AI chips and their packaging.",
    INTC: "Intel designs and manufactures processors. Its Xeon server chips and AI accelerators run AI workloads in data centers.",
    MRVL: "Marvell designs data infrastructure chips. It supplies custom AI silicon and optical networking components that move data between AI servers.",
    ARM: "Arm licenses processor designs and instruction sets to chipmakers. Arm-based server CPUs support AI accelerators, and its processor designs can run AI on devices.",
    AMKR: "Amkor packages and tests chips for semiconductor designers. Its advanced packaging helps integrate the processors and memory used in AI hardware.",
  },
  "AI data centers and infrastructure": {
    EQIX: "Equinix operates colocation data centers and interconnection services. It provides space and connections for businesses to deploy AI infrastructure near their data and cloud providers.",
    DLR: "Digital Realty owns and operates data centers. It offers high-density capacity for tenants deploying power-hungry AI servers.",
    VRT: "Vertiv makes power and cooling equipment for data centers. Its liquid cooling and power systems support dense racks of AI accelerators.",
    ANET: "Arista Networks makes data center switches and networking software. Its high-speed Ethernet connects the servers in AI training clusters.",
    DELL: "Dell sells computers, servers and storage. It builds GPU-equipped servers and integrated systems for businesses running AI in their own data centers.",
    HPE: "Hewlett Packard Enterprise sells servers, networking and supercomputers. Its GPU-equipped systems and liquid cooling support AI training and inference.",
    SMCI: "Supermicro makes servers and rack-scale computing systems. It assembles GPU servers and liquid-cooled racks for AI workloads.",
    CRWV: "CoreWeave provides cloud computing built around GPUs. Customers rent its computing capacity to train and run AI models.",
    NBIS: "Nebius operates AI cloud infrastructure. It offers GPU computing and software tools for developers training and deploying AI models.",
    APLD: "Applied Digital develops and operates large data center campuses. It provides power, cooling and space for customers deploying AI computing equipment.",
  },
  "AI models, platforms and cloud": {
    MSFT: "Microsoft makes enterprise software and operates Azure. It delivers AI through Copilot and sells cloud computing and model services through Azure.",
    GOOG: alphabetAi,
    GOOGL: alphabetAi,
    AMZN: "Amazon operates online retail and AWS cloud computing. AWS provides Bedrock model services and Trainium chips for building and deploying AI applications.",
    META: "Meta operates Facebook, Instagram and WhatsApp. It develops Llama models and uses AI to power recommendations and assistants across its apps.",
    ORCL: "Oracle sells database software, business applications and cloud services. Oracle Cloud Infrastructure rents GPU computing for AI training and inference.",
    PLTR: "Palantir builds software that helps organizations combine and analyze data. Its AI Platform connects AI models with organizational data and workflows.",
    AI: "C3 AI makes enterprise software. Its platform helps organizations build and deploy AI applications for tasks such as predictive maintenance.",
    IBM: "IBM sells enterprise technology and consulting services. Its watsonx platform helps businesses build, deploy and govern AI models.",
    SNOW: "Snowflake runs a cloud platform for storing and analyzing data. Its Cortex services let customers use AI models with data held on the platform.",
  },
};

export function aiCompany(symbol) {
  const match = Object.entries(aiThemes).find(([, companies]) => Object.hasOwn(companies, symbol));
  return match ? { theme: match[0], description: match[1][symbol] } : null;
}


export function issuerKey(symbol, source) {
  if (symbol === "GOOG" || symbol === "GOOGL") return "CIK:1652044";
  const cik = source?.match(/^https:\/\/www\.sec\.gov\/edgar\/browse\/\?CIK=0*(\d+)$/)?.[1];
  return cik ? "CIK:" + cik : "Ticker:" + symbol;
}

export function uniqueIssuers(rows) {
  const seen = new Set();
  return rows.filter(({ issuerId }) => {
    if (seen.has(issuerId)) return false;
    seen.add(issuerId);
    return true;
  });
}

export function rankChecklistRows(rows) {
  return [...rows].sort((a, b) =>
    b.passes - a.passes || missingChecks(a) - missingChecks(b) ||
    positivePe(a.trailing) - positivePe(b.trailing) || a.symbol.localeCompare(b.symbol));
}

export function withTrendCheck(row) {
  const {trend, date, source} = row.technicals ?? {};
  const {close, sma200} = trend ?? {};
  const available = [close, sma200].every(value => Number.isFinite(value) && value > 0);
  const passed = available ? close > sma200 : null;
  const measurement = available
    ? [money(close) + " close / " + money(sma200) + " SMA", date, source].filter(Boolean).join(" · ")
    : "Completed daily close or 200-day SMA unavailable";
  return {...row, passes: row.passes + Number(passed === true),
    checks: [...row.checks, ["Completed close above 200-day SMA", passed, measurement]]};
}
