/* eslint-disable @typescript-eslint/no-explicit-any */
// Audio lessons are spoken by the device (works offline). Any figure in a lesson
// is pulled from the dataset at runtime, never typed into the text.
import { inr } from "./engine";

const stipend = (d: any, match: string) => d.stipends.find((s: any) => String(s.category).toLowerCase().includes(match))?.current;
const scheme = (d: any, id: string) => d.scholarships.find((s: any) => s.id === id);

export function lessons(d: any, lang: string) {
  const iti = d.centres.filter((c: any) => String(c.type).includes("ITI")).length;
  const itiStipend = inr(stipend(d, "iti"));
  const class10 = inr(stipend(d, "class 10"));
  const sch14 = scheme(d, "SCH14");
  const sch16 = scheme(d, "SCH16");
  const income16 = sch16?.income_limit ? inr(sch16.income_limit) : "—";
  const L: Record<string, any[]> = {
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
  return L[lang] || L.en;
}

export function quiz(d: any) {
  const itiS = stipend(d, "iti");
  const c10 = stipend(d, "class 10");
  const sch16 = scheme(d, "SCH16");
  const iti = d.centres.filter((c: any) => String(c.type).includes("ITI")).length;
  const wrong = (v: number, f: number[]) => f.map((x) => inr(Math.round((v * x) / 100) * 100));
  return [
    { q: "After which class can you join an ITI?", options: ["Class 5", "Class 10", "Only after a degree"], answer: 1 },
    { q: "Minimum monthly stipend for an ITI apprentice?", options: [inr(itiS), ...wrong(itiS, [0.5, 2])], answer: 0 },
    { q: "Minimum monthly stipend for an apprentice after Class 10?", options: [...wrong(c10, [0.6]), inr(c10), ...wrong(c10, [1.8])], answer: 1 },
    { q: "Which document proves family income for a scholarship?", options: ["Aadhaar card", "Income certificate", "Ration card only"], answer: 1 },
    { q: `How many government ITIs are in our Pune list?`, options: [String(iti), String(iti + 9), String(Math.max(1, iti - 10))], answer: 0 },
    ...(sch16?.income_limit ? [{ q: "Income limit for the Maharashtra OBC post-matric scholarship?", options: [inr(sch16.income_limit * 2), inr(sch16.income_limit), inr(sch16.income_limit / 2)], answer: 1 }] : []),
  ].slice(0, 5);
}
