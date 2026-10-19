/**
 * 上屏安全过滤。beats / headline 会被 Helixus 念出来，所以：
 * 网址、联系方式、长串数字、现实政治话题一律挡掉。
 * 原始思维链永远不上屏、不进 helixus-link 事件（只写本地日志）。
 */

const URL_RE = /(https?:\/\/|www\.)[^\s，。；、）》）)]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)|\b\d{3,4}-\d{7,8}\b/g;
const ID_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g;
const LONG_DIGITS_RE = /(?<!\d)\d{7,}(?!\d)/g;

/** 只挡现实政治，不挡奇幻里的“国王/战争/神殿”。 */
const POLITICS_RE =
  /(习近平|毛泽东|邓小平|江泽民|胡锦涛|特朗普|拜登|普京|泽连斯基|选举|政党|政府|总统|首相|议会|政治|两会|台湾|香港|新疆|西藏|六四|法轮功|核酸|封控|疫情|示威|游行|镇压)/g;

export interface ScreenResult {
  text: string;
  ok: boolean;
  reasons: string[];
}

export function screenText(input: string | null | undefined): ScreenResult {
  let text = String(input ?? '');
  const reasons: string[] = [];
  const apply = (re: RegExp, label: string) => {
    re.lastIndex = 0;
    if (re.test(text)) {
      reasons.push(label);
      re.lastIndex = 0;
      text = text.replace(re, '□');
    }
  };
  apply(URL_RE, '网址');
  apply(EMAIL_RE, '邮箱');
  apply(PHONE_RE, '电话');
  apply(ID_RE, '证件号');
  apply(LONG_DIGITS_RE, '长数字');
  apply(POLITICS_RE, '现实政治');
  return { text: text.replace(/□+/g, '□').trim(), ok: reasons.length === 0, reasons };
}

/** 原文里逐字可查（忽略空白差异） */
export function quoteInReasoning(quote: string, reasoning: string): boolean {
  const q = quote.replace(/\s+/g, '');
  if ([...q].length < 4) return false;
  return reasoning.replace(/\s+/g, '').includes(q);
}

/**
 * 模型在考虑「输出格式」的段落不是角色的想法：
 *   「被咬了一口，hurt 更合适，但嘴上带刺是 angry。选 angry。」
 *   「我需要以薇克丝的身份回答，expression 填 smug」
 * 上屏就等于编造角色的心里话，所以这类 beat/quote 一律丢掉。
 * 注意：只匹配「格式/表情选择」的语境，正常的英文思考（I'm thinking …）不挡。
 */
const META_REASONING_PATTERNS: RegExp[] = [
  /(?:\bjson\b|输出格式|格式要求|输出一个对象|返回一个对象|字段|schema|expression\s*[:：=])/i,
  /(?:选择|选用|选|填|填成|用|choose|select|pick|use)\s*(?:the\s+)?(?:表情\s*)?["'「『]?(neutral|happy|smug|angry|scared|surprised|thinking|hurt)["'」』]?/i,
  /(neutral|happy|smug|angry|scared|surprised|thinking|hurt)[\s\S]{0,24}(?:expression|表情|更合适|更贴切|fits? better|more appropriate|seems right)/i,
  /(?:expression|表情)[\s\S]{0,24}(neutral|happy|smug|angry|scared|surprised|thinking|hurt)/i,
  /(?:选|填|用|choose|select|pick)\s*(?:the\s+)?expression/i,
  /expression\s*(?:字段|该填|填什么|怎么填|选)/i,
  /我需要以.{0,24}的身份/,
  /以.{0,24}的身份(?:回答|说话|输出|行动|思考)/,
  /\\?["'「]expression\\?["'」]\s*[:：]/i,
];

export function isMetaReasoning(input: string | null | undefined): boolean {
  const text = String(input ?? '');
  if (!text) return false;
  return META_REASONING_PATTERNS.some((re) => re.test(text));
}

/** 粗略的 2-gram 覆盖率，用来判断 beat 的用词是否来自原文（辅助，不作为唯一依据） */
export function bigramCoverage(text: string, source: string): number {
  const clean = text.replace(/[\s，。！？、；：""''「」『』（）()…—]/g, '');
  const chars = [...clean];
  if (chars.length < 2) return 0;
  const src = new Set<string>();
  const s = [...source.replace(/\s+/g, '')];
  for (let i = 0; i < s.length - 1; i++) src.add(s[i] + s[i + 1]);
  let hit = 0;
  let total = 0;
  for (let i = 0; i < chars.length - 1; i++) {
    total += 1;
    if (src.has(chars[i] + chars[i + 1])) hit += 1;
  }
  return total ? hit / total : 0;
}
