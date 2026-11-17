// Autocorrect: fixes common typos and contractions as you type, turns typed symbols into
// typographic ones (-> into →), curls quotes, and expands the user's own shortcuts. It runs
// when a word ends (space or punctuation), and Backspace right after undoes it. Pure functions:
// the page editor (a ProseMirror plugin) and the chat box (a textarea) both call these.

export type Replacement = { from: string; to: string };

export type AutocorrectOptions = {
  enabled: boolean;
  /** Common misspellings and missing apostrophes (teh → the, dont → don't, i → I). */
  typos: boolean;
  /** -> → →, -- → —, ... → …, (c) → © and the like. */
  symbols: boolean;
  /** "straight" → “curly” quotes and apostrophes. */
  smartQuotes: boolean;
  /** Also in the AI chat's message box (typos and your own shortcuts only: messages often hold code). */
  inChat: boolean;
  /** The user's own shortcuts, e.g. omw → on my way. */
  replacements: Replacement[];
};

export const DEFAULT_AUTOCORRECT: AutocorrectOptions = {
  enabled: true,
  typos: true,
  symbols: true,
  smartQuotes: false,
  inChat: true,
  replacements: [],
};

/** Stored options merged over the defaults (older saves lack newer fields). */
export const autocorrectOptions = (saved?: Partial<AutocorrectOptions> | null): AutocorrectOptions => ({
  ...DEFAULT_AUTOCORRECT,
  ...(saved ?? {}),
  replacements: Array.isArray(saved?.replacements) ? saved.replacements.filter((r) => r?.from?.trim() && typeof r.to === "string") : [],
});

/** Characters that end a word and trigger a correction. */
export const TRIGGERS = new Set([" ", ".", ",", "!", "?", ";", ":", ")"]);

// Only words that are never right as typed: no real words (its, were, ill, cant, wont, lets, id).
const APOSTROPHE: Record<string, string> = {
  im: "I'm",
  ive: "I've",
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  havent: "haven't",
  hasnt: "hasn't",
  hadnt: "hadn't",
  wouldnt: "wouldn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  mustnt: "mustn't",
  neednt: "needn't",
  youre: "you're",
  youve: "you've",
  youll: "you'll",
  youd: "you'd",
  theyre: "they're",
  theyve: "they've",
  theyll: "they'll",
  theyd: "they'd",
  thats: "that's",
  whats: "what's",
  wheres: "where's",
  whos: "who's",
  hows: "how's",
  theres: "there's",
  heres: "here's",
  wouldve: "would've",
  couldve: "could've",
  shouldve: "should've",
  mightve: "might've",
  aint: "ain't",
  yall: "y'all",
};

const TYPOS: Record<string, string> = {
  teh: "the", hte: "the", tthe: "the", adn: "and", nad: "and", taht: "that", thta: "that", waht: "what", whta: "what",
  jsut: "just", knwo: "know", konw: "know", nkow: "know", liek: "like", wiht: "with", wtih: "with", whcih: "which",
  wich: "which", becuase: "because", beacuse: "because", becasue: "because", abotu: "about", agian: "again",
  alraedy: "already", alredy: "already", anwser: "answer", aslo: "also", chnage: "change", cna: "can", coudl: "could",
  woudl: "would", shoudl: "should", dosent: "doesn't", eveyr: "every", finsih: "finish", fomr: "form", frist: "first",
  goign: "going", hda: "had", hwo: "how", iwll: "will", mkae: "make", nwo: "now", peopel: "people", poeple: "people",
  probelm: "problem", realyl: "really", realy: "really", sya: "say", smae: "same", soem: "some", somethign: "something",
  stil: "still", tehy: "they", tehn: "then", thier: "their", thsi: "this", tihs: "this", tiem: "time", wrok: "work",
  yaer: "year", yoru: "your", alot: "a lot", untill: "until", recieve: "receive", recieved: "received",
  seperate: "separate", definately: "definitely", definatly: "definitely", occured: "occurred", occurence: "occurrence",
  occurance: "occurrence", accomodate: "accommodate", acheive: "achieve", beleive: "believe", calender: "calendar",
  comming: "coming", concious: "conscious", existance: "existence", foward: "forward", freind: "friend",
  goverment: "government", happend: "happened", immediatly: "immediately", imediately: "immediately",
  independant: "independent", knowlege: "knowledge", liason: "liaison", neccessary: "necessary", necesary: "necessary",
  occassion: "occasion", persistant: "persistent", posession: "possession", prefered: "preferred",
  publically: "publicly", recomend: "recommend", reccomend: "recommend", refered: "referred", relevent: "relevant",
  religous: "religious", remeber: "remember", rember: "remember", responsiblity: "responsibility", rythm: "rhythm",
  succesful: "successful", successfull: "successful", suprise: "surprise", tommorow: "tomorrow", tomorow: "tomorrow",
  tommorrow: "tomorrow", tounge: "tongue", truely: "truly", wierd: "weird", whereever: "wherever", writting: "writing",
  abscence: "absence", adress: "address", agressive: "aggressive", apparantly: "apparently", arguement: "argument",
  basicly: "basically", begining: "beginning", bizzare: "bizarre", buisness: "business", catagory: "category",
  cemetary: "cemetery", collegue: "colleague", commited: "committed", comittee: "committee", completly: "completely",
  curiousity: "curiosity", decieve: "deceive", dissapoint: "disappoint", embarass: "embarrass", enviroment: "environment",
  exagerate: "exaggerate", excercise: "exercise", familar: "familiar", finaly: "finally", fourty: "forty",
  fullfil: "fulfil", gaurd: "guard", grammer: "grammar", guage: "gauge", harrass: "harass", heigth: "height",
  hieght: "height", interupt: "interrupt", lenght: "length", libary: "library", maintainance: "maintenance",
  millenium: "millennium", mischevious: "mischievous", neice: "niece", noticable: "noticeable", oppurtunity: "opportunity",
  paralell: "parallel", particulary: "particularly", peice: "piece", posible: "possible", preceed: "precede",
  presense: "presence", privelege: "privilege", probaly: "probably", pronounciation: "pronunciation",
  questionaire: "questionnaire", resturant: "restaurant", sentance: "sentence", similiar: "similar",
  sincerly: "sincerely", speach: "speech", strenght: "strength", threshhold: "threshold", togehter: "together",
  unfortunatly: "unfortunately", vaccuum: "vacuum", vegatable: "vegetable", visable: "visible", withold: "withhold",
  yeild: "yield", acutally: "actually", actualy: "actually", basiclly: "basically", differnt: "different",
  diffrent: "different", enought: "enough", exmaple: "example", explaination: "explanation", foriegn: "foreign",
  gurantee: "guarantee", helpfull: "helpful", importnat: "important", intresting: "interesting", languege: "language",
  lightening: "lightning", mispell: "misspell", mispelled: "misspelled", neighbour: "neighbour", noone: "no one",
  ocurred: "occurred", passtime: "pastime", perfomance: "performance", recieving: "receiving", sucess: "success",
  supposably: "supposedly", thru: "through", tought: "thought", usualy: "usually", wnat: "want", wnats: "wants",
};

/** Typed sequences that become a symbol (longest first, so <-> wins over ->). */
const SYMBOLS: [string, string][] = [
  ["<->", "↔"],
  ["<=>", "⇔"],
  ["...", "…"],
  ["->", "→"],
  ["<-", "←"],
  ["=>", "⇒"],
  ["--", "—"],
  ["!=", "≠"],
  [">=", "≥"],
  ["<=", "≤"],
  ["+-", "±"],
  ["(c)", "©"],
  ["(C)", "©"],
  ["(r)", "®"],
  ["(R)", "®"],
  ["(tm)", "™"],
  ["(TM)", "™"],
];

/** Keeps the typed word's capitalisation: Teh → The, TEH → THE, i → I. */
function matchCase(typed: string, fixed: string): string {
  if (fixed === "I" || fixed.startsWith("I'")) return fixed;
  if (typed.length > 1 && typed === typed.toUpperCase() && /[A-Z]/.test(typed)) return fixed.toUpperCase();
  if (typed[0] === typed[0].toUpperCase() && typed[0] !== typed[0].toLowerCase()) return fixed.charAt(0).toUpperCase() + fixed.slice(1);
  return fixed;
}

const curly = (s: string, on: boolean) => (on ? s.replace(/'/g, "’") : s);

/** Whether a word may be corrected: it starts the text or follows a space or an opening mark. */
const atBoundary = (before: string, start: number) => start === 0 || /[\s([{"'“‘—–-]/.test(before[start - 1]);

export type Correction = { length: number; text: string };

/**
 * What to do when `trigger` is typed after `before` (the text before the caret, in the same
 * paragraph): replace the last `length` characters of `before` with `text`. Null: nothing.
 */
export function correction(before: string, trigger: string, o: AutocorrectOptions): Correction | null {
  if (!o.enabled || !TRIGGERS.has(trigger) || !before) return null;

  // The user's own shortcuts first; they may contain symbols ("->") or several words.
  for (const r of [...o.replacements].sort((a, b) => b.from.length - a.from.length)) {
    const from = r.from.trim();
    if (!from || !before.endsWith(from)) continue;
    const start = before.length - from.length;
    if (/^[\w']+$/.test(from) && !atBoundary(before, start)) continue;
    return { length: from.length, text: r.to };
  }

  if (o.symbols) {
    // "..." becomes … only when a word ends with it, so ".." + "." isn't caught mid-typing.
    for (const [from, to] of SYMBOLS) {
      // Not at the start of a line, where "---", "-> " and the like are Markdown shortcuts.
      if (before.endsWith(from) && /[^\s-]/.test(before.slice(0, -from.length))) return { length: from.length, text: to };
    }
  }

  if (o.typos) {
    const m = /[A-Za-z']+$/.exec(before);
    if (!m) return null;
    const word = m[0].replace(/^'+/, "");
    const start = before.length - word.length;
    if (!word || !atBoundary(before, start)) return null;
    const lower = word.toLowerCase();
    // Not before a full stop: "i.e." stays as typed.
    if (lower === "i") return word === "I" || trigger === "." ? null : { length: 1, text: "I" };
    const fixed = APOSTROPHE[lower] ?? TYPOS[lower] ?? (lower === "i'm" || lower === "i've" || lower === "i'll" || lower === "i'd" ? `I${word.slice(1)}` : null);
    if (!fixed) return null;
    const text = curly(matchCase(word, fixed), o.smartQuotes);
    return text === word ? null : { length: word.length, text };
  }
  return null;
}

/** The curly quote to type in place of a straight one, given the text before it. */
export function smartQuote(before: string, quote: '"' | "'"): string {
  const prev = before.slice(-1);
  const opening = !prev || /[\s([{—–\-“‘]/.test(prev);
  if (quote === '"') return opening ? "“" : "”";
  return opening ? "‘" : "’";
}
