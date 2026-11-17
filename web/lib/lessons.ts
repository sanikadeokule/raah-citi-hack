/* eslint-disable @typescript-eslint/no-explicit-any */
// Audio lessons are spoken by the device (works offline). Any figure in a lesson
// is pulled from the dataset at runtime, never typed into the text.
// The three "basics" lessons below are built here because they quote live figures;
// every other lesson, topic and quiz question comes from the Lessons and
// Lesson_Topics sheets, so adding a lesson is an Excel edit.
import { inr, rankCareers } from "./engine";

export interface QuizItem { q: string; options: string[]; answer: number }
export interface Lesson { id: string; topic: string; title: string; text: string; quiz: QuizItem | null; career_ids: string[]; tags: string[] }

export const FOR_YOU = "for_you";

const stipend = (d: any, match: string) => d.stipends.find((s: any) => String(s.category).toLowerCase().includes(match))?.current;
const scheme = (d: any, id: string) => d.scholarships.find((s: any) => s.id === id);

/** Where the right answer sits among the options: fixed per question, so it does not move on every render. */
export function placeAnswer(id: string, right: string, wrong: string[]): QuizItem {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const answer = h % (wrong.length + 1);
  const options = [...wrong];
  options.splice(answer, 0, right);
  return { q: "", options, answer };
}

function quizItem(id: string, q: string | null | undefined, right: string | null | undefined, wrong: string[] | undefined): QuizItem | null {
  if (!q || !right || !wrong?.length) return null;
  return { ...placeAnswer(id, right, wrong), q };
}

// easy, no-number questions for the built-in lessons: [question, right, wrong; wrong]
const BASIC_QUIZ: Record<string, Record<string, [string, string, string[]]>> = {
  en: {
    L1: ["After which class can you join an ITI?", "Class 10", ["Class 5", "Only after a degree"]],
    L2: ["What happens in an apprenticeship?", "You learn at a real workplace and get paid", ["You only read books at home", "You pay a big fee to work"]],
    L3: ["Where should you apply for a scholarship?", "On the official government portal", ["Through an agent who takes money", "Nowhere, it comes by itself"]],
  },
  hi: {
    L1: ["ITI में किस कक्षा के बाद प्रवेश ले सकते हैं?", "दसवीं", ["पाँचवीं", "सिर्फ़ डिग्री के बाद"]],
    L2: ["अप्रेंटिसशिप में क्या होता है?", "असली काम की जगह पर सीखते हैं और पैसे मिलते हैं", ["सिर्फ़ घर पर किताबें पढ़ते हैं", "काम करने के लिए बड़ी फ़ीस देते हैं"]],
    L3: ["छात्रवृत्ति के लिए कहाँ आवेदन करना चाहिए?", "आधिकारिक सरकारी पोर्टल पर", ["पैसे लेने वाले एजेंट से", "कहीं नहीं, अपने आप मिलती है"]],
  },
  mr: {
    L1: ["ITI ला कोणत्या इयत्तेनंतर प्रवेश घेता येतो?", "दहावी", ["पाचवी", "फक्त पदवीनंतर"]],
    L2: ["अप्रेंटिसशिपमध्ये काय होते?", "प्रत्यक्ष कामाच्या ठिकाणी शिकतो आणि पैसे मिळतात", ["फक्त घरी पुस्तके वाचतो", "काम करण्यासाठी मोठी फी भरतो"]],
    L3: ["शिष्यवृत्तीसाठी अर्ज कुठे करावा?", "अधिकृत सरकारी पोर्टलवर", ["पैसे घेणाऱ्या एजंटकडे", "कुठेच नाही, आपोआप मिळते"]],
  },
};

function basics(d: any, lang: string): Lesson[] {
  const iti = d.centres.filter((c: any) => String(c.type).includes("ITI")).length;
  const itiStipend = inr(stipend(d, "iti"));
  const class10 = inr(stipend(d, "class 10"));
  const sch14 = scheme(d, "SCH14");
  const sch16 = scheme(d, "SCH16");
  const income16 = sch16?.income_limit ? inr(sch16.income_limit) : "—";
  const L: Record<string, { id: string; title: string; text: string }[]> = {
    en: [
      { id: "L1", title: "What is an ITI?", text: `An ITI is an Industrial Training Institute. After Class 10 you can learn a trade like electrician, fitter or welder in one or two years. Pune district has ${iti} government ITIs in our list. Government ITI trainees in Maharashtra can get ${sch14?.amount_text ?? "a stipend"}.` },
      { id: "L2", title: "What is an apprenticeship?", text: `In an apprenticeship you learn at a real workplace and get paid. The minimum stipend is ${itiStipend} a month for ITI holders and ${class10} a month after Class 10, under the latest government rates.` },
      { id: "L3", title: "How do scholarships work?", text: `A scholarship is money from the government for your studies. Each scheme has rules, like family income. For example the Maharashtra OBC post-matric scholarship needs family income up to ${income16} a year. Keep your income certificate, caste certificate and marksheets ready. Apply on the official portal, never pay an agent.` },
    ],
    mr: [
      { id: "L1", title: "ITI म्हणजे काय?", text: `ITI म्हणजे औद्योगिक प्रशिक्षण संस्था. दहावीनंतर एक-दोन वर्षांत इलेक्ट्रिशियन, फिटर, वेल्डर असा व्यवसाय शिकता येतो. आपल्या यादीत पुणे जिल्ह्यात ${iti} सरकारी ITI आहेत. महाराष्ट्रातील सरकारी ITI प्रशिक्षणार्थ्यांना ${sch14?.amount_text ?? "मानधन"} मिळू शकते.` },
      { id: "L2", title: "अप्रेंटिसशिप म्हणजे काय?", text: `अप्रेंटिसशिपमध्ये तुम्ही प्रत्यक्ष कामाच्या ठिकाणी शिकता आणि पैसेही मिळतात. नव्या सरकारी दरानुसार ITI झालेल्यांना किमान ${itiStipend} आणि दहावी झालेल्यांना किमान ${class10} महिना मानधन मिळते.` },
      { id: "L3", title: "शिष्यवृत्ती कशी मिळते?", text: `शिष्यवृत्ती म्हणजे शिक्षणासाठी सरकारकडून मिळणारे पैसे. प्रत्येक योजनेच्या अटी असतात, जसे कुटुंबाचे उत्पन्न. उदाहरणार्थ महाराष्ट्र OBC पोस्ट-मॅट्रिक शिष्यवृत्तीसाठी वार्षिक उत्पन्न ${income16} पर्यंत हवे. उत्पन्नाचा दाखला, जातीचा दाखला आणि गुणपत्रिका तयार ठेवा. अधिकृत पोर्टलवरच अर्ज करा, एजंटला पैसे देऊ नका.` },
    ],
    hi: [
      { id: "L1", title: "ITI क्या है?", text: `ITI यानी औद्योगिक प्रशिक्षण संस्थान। दसवीं के बाद एक-दो साल में इलेक्ट्रीशियन, फिटर, वेल्डर जैसा काम सीख सकते हैं। हमारी सूची में पुणे ज़िले में ${iti} सरकारी ITI हैं। महाराष्ट्र के सरकारी ITI प्रशिक्षुओं को ${sch14?.amount_text ?? "वज़ीफ़ा"} मिल सकता है।` },
      { id: "L2", title: "अप्रेंटिसशिप क्या है?", text: `अप्रेंटिसशिप में आप असली काम की जगह पर सीखते हैं और पैसे भी मिलते हैं। नई सरकारी दरों के अनुसार ITI वालों को कम से कम ${itiStipend} और दसवीं पास को कम से कम ${class10} महीना मिलता है।` },
      { id: "L3", title: "छात्रवृत्ति कैसे मिलती है?", text: `छात्रवृत्ति यानी पढ़ाई के लिए सरकार से मिलने वाला पैसा। हर योजना की शर्तें होती हैं, जैसे परिवार की आय। जैसे महाराष्ट्र OBC पोस्ट-मैट्रिक छात्रवृत्ति के लिए सालाना आय ${income16} तक होनी चाहिए। आय प्रमाणपत्र, जाति प्रमाणपत्र और मार्कशीट तैयार रखें। सिर्फ़ आधिकारिक पोर्टल पर आवेदन करें, एजेंट को पैसे न दें।` },
    ],
  };
  const quiz = BASIC_QUIZ[lang] || BASIC_QUIZ.en;
  return (L[lang] || L.en).map((l) => {
    const [q, right, wrong] = quiz[l.id];
    return { ...l, topic: "basics", quiz: quizItem(l.id, q, right, wrong), career_ids: [], tags: [] };
  });
}

/** Every lesson in the student's language: the built-in basics, then the Lessons sheet (English when a translation is blank). */
export function lessons(d: any, lang: string): Lesson[] {
  const fromSheet: Lesson[] = (d.lessons || []).map((l: any) => {
    const x = l.text[lang] || l.text.en;
    return { id: l.id, topic: l.topic, title: x.title, text: x.text, quiz: quizItem(l.id, x.q, x.right, x.wrong), career_ids: l.career_ids || [], tags: l.tags || [] };
  });
  return [...basics(d, lang), ...fromSheet];
}

/** Topics for the dropdown, in sheet order; topics with no lessons are left out. */
export function lessonTopics(d: any, lang: string, all: Lesson[]) {
  const used = new Set(all.map((l) => l.topic));
  return (d.lesson_topics || []).filter((t: any) => used.has(t.id)).map((t: any) => ({ id: t.id, name: t.name[lang] || t.name.en }));
}

/**
 * Lessons about the student's own careers: the top careers from the same ranking the Careers screen
 * uses, plus general lessons whose interest tags the student picked. Empty when we know nothing about them.
 */
export function forYou(d: any, profile: any, all: Lesson[]): Lesson[] {
  if (!profile || !(profile.interests || []).length) return [];
  const top: string[] = rankCareers(d, profile, 5).filter((s: any) => s.fit !== "none").map((s: any) => s.career.id);
  const said = new Set((profile.interests || []).map((i: any) => String(i).trim().toLowerCase()));
  const rank = (l: Lesson) => {
    const byCareer = l.career_ids.map((c) => top.indexOf(c)).filter((i) => i >= 0);
    const byTag = l.tags.some((t) => said.has(t.toLowerCase()));
    if (!byCareer.length && !byTag) return null;
    // a lesson about one of their careers first, in ranking order; then general lessons on what they enjoy
    return l.career_ids.length === 1 && byCareer.length ? byCareer[0] : 10 + (byCareer.length ? Math.min(...byCareer) : 5);
  };
  return all.map((l) => ({ l, r: rank(l) })).filter((x) => x.r !== null)
    .sort((a, b) => (a.r as number) - (b.r as number)).map((x) => x.l);
}

/** Up to five easy questions from the lessons on screen. */
export function quiz(ls: Lesson[], n = 5): QuizItem[] {
  return ls.filter((l) => l.quiz).slice(0, n).map((l) => l.quiz as QuizItem);
}
