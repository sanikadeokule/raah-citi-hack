"""Add six general-knowledge lessons (English / Hindi / Marathi) covering the careers added by add_demand_careers.py.

Run from backend/:  python scripts/add_demand_lessons.py [path-to-xlsx]
Idempotent: lesson IDs already present are left alone. No figures are quoted; edit the sheet freely.
"""
import sys
from pathlib import Path

import openpyxl

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"
STATUS = "Plain general-knowledge lesson for Class 8-12 students - edit freely"

# id, topic, career ids, tags, (en, hi, mr) each = (title, lesson, question, right answer, wrong answers joined by ;)
LESSONS = [
 ("G06", "health", "CAR52; CAR53; CAR54; CAR55", "health; hospital work; patient care; science",
  ("What does a health technician do?",
   "Hospitals and clinics need many trained helpers besides doctors and nurses. A lab technician tests blood and other samples. A pharmacy assistant gives medicines as the prescription says. An X-ray technician takes scans for the doctor. A physiotherapy assistant helps patients move and recover. Most of these jobs start after Class 12 Science with a diploma or a short degree. Care, accuracy and cleanliness matter a lot, because a doctor depends on your work.",
   "Who tests blood samples in a hospital?", "A lab technician", "An X-ray technician only; A security guard"),
  ("स्वास्थ्य तकनीशियन क्या करता है?",
   "अस्पतालों और क्लिनिकों में डॉक्टर और नर्स के अलावा कई प्रशिक्षित सहायक चाहिए। लैब तकनीशियन ख़ून और दूसरे नमूनों की जाँच करता है। फ़ार्मेसी सहायक पर्ची के अनुसार दवा देता है। एक्स-रे तकनीशियन डॉक्टर के लिए स्कैन लेता है। फ़िज़ियोथेरेपी सहायक मरीज़ों को चलने-फिरने और ठीक होने में मदद करता है। इनमें से ज़्यादातर काम बारहवीं विज्ञान के बाद डिप्लोमा या छोटी डिग्री से शुरू होते हैं। देखभाल, सटीकता और सफ़ाई बहुत ज़रूरी हैं, क्योंकि डॉक्टर आपके काम पर निर्भर करता है।",
   "अस्पताल में ख़ून के नमूनों की जाँच कौन करता है?", "लैब तकनीशियन", "सिर्फ़ एक्स-रे तकनीशियन; सिक्योरिटी गार्ड"),
  ("आरोग्य तंत्रज्ञ काय करतो?",
   "रुग्णालये आणि क्लिनिकमध्ये डॉक्टर आणि नर्स यांच्याशिवाय अनेक प्रशिक्षित मदतनीस लागतात. लॅब तंत्रज्ञ रक्त आणि इतर नमुन्यांची तपासणी करतो. फार्मसी सहायक चिठ्ठीप्रमाणे औषधे देतो. एक्स-रे तंत्रज्ञ डॉक्टरांसाठी स्कॅन काढतो. फिजिओथेरपी सहायक रुग्णांना हालचाल करण्यात आणि बरे होण्यात मदत करतो. यापैकी बहुतेक कामे बारावी विज्ञानानंतर डिप्लोमा किंवा छोट्या पदवीने सुरू होतात. काळजी, अचूकता आणि स्वच्छता खूप महत्त्वाची आहे, कारण डॉक्टर तुमच्या कामावर अवलंबून असतात.",
   "रुग्णालयात रक्ताच्या नमुन्यांची तपासणी कोण करतो?", "लॅब तंत्रज्ञ", "फक्त एक्स-रे तंत्रज्ञ; सुरक्षा रक्षक")),
 ("G07", "office", "CAR56; CAR57", "computers; typing; data entry; customer service",
  ("What do back-office and support jobs involve?",
   "Many companies have teams that keep records and talk to customers. A data entry operator types information into computer systems accurately. A customer support executive answers calls, chats or emails and solves problems politely. These jobs can start after Class 10 or 12 with typing, computer basics and good communication. Speaking clearly in more than one language is a real advantage. Some of this work is being automated, so keep learning new tools to grow.",
   "What is the main skill of a customer support executive?", "Solving customers' problems politely and clearly", "Welding metal; Driving a heavy truck"),
  ("बैक-ऑफ़िस और सपोर्ट के काम में क्या होता है?",
   "कई कंपनियों में ऐसी टीमें होती हैं जो रिकॉर्ड रखती हैं और ग्राहकों से बात करती हैं। डेटा एंट्री ऑपरेटर कंप्यूटर में जानकारी सही-सही टाइप करता है। कस्टमर सपोर्ट एक्ज़ीक्यूटिव फ़ोन, चैट या ईमेल पर जवाब देता है और विनम्रता से समस्याएँ सुलझाता है। ये काम दसवीं या बारहवीं के बाद टाइपिंग, कंप्यूटर की बुनियादी जानकारी और अच्छी बातचीत से शुरू हो सकते हैं। एक से ज़्यादा भाषाएँ साफ़ बोल पाना बड़ा फ़ायदा है। इसमें से कुछ काम मशीनों से होने लगा है, इसलिए आगे बढ़ने के लिए नए टूल सीखते रहें।",
   "कस्टमर सपोर्ट एक्ज़ीक्यूटिव का मुख्य हुनर क्या है?", "ग्राहकों की समस्याएँ विनम्रता और साफ़ तरीक़े से सुलझाना", "धातु की वेल्डिंग करना; भारी ट्रक चलाना"),
  ("बॅक-ऑफिस आणि सपोर्टच्या कामात काय असते?",
   "अनेक कंपन्यांमध्ये अशा टीम असतात ज्या नोंदी ठेवतात आणि ग्राहकांशी बोलतात. डेटा एंट्री ऑपरेटर संगणकात माहिती अचूक टाइप करतो. कस्टमर सपोर्ट एक्झिक्युटिव्ह फोन, चॅट किंवा ईमेलवर उत्तर देतो आणि नम्रपणे अडचणी सोडवतो. ही कामे दहावी किंवा बारावीनंतर टायपिंग, संगणकाची मूलभूत माहिती आणि चांगल्या संवादाने सुरू होऊ शकतात. एकापेक्षा जास्त भाषा स्पष्ट बोलता येणे हा मोठा फायदा आहे. यातील काही काम यंत्रांकडून होऊ लागले आहे, म्हणून पुढे जाण्यासाठी नवीन साधने शिकत राहा.",
   "कस्टमर सपोर्ट एक्झिक्युटिव्हचे मुख्य कौशल्य कोणते?", "ग्राहकांच्या अडचणी नम्रपणे आणि स्पष्टपणे सोडवणे", "धातूचे वेल्डिंग करणे; जड ट्रक चालवणे")),
 ("G08", "engineering", "CAR58; CAR59", "programming; design; creativity; computers",
  ("What do web developers and designers do?",
   "A web or app developer writes code that makes websites and phone apps work. A graphic or digital designer makes the look of posters, apps and websites. Both can start with a good short course and a small portfolio of work you have made yourself, and a BCA or design course helps. Employers look at what you can show, not only at marks. Beginners usually earn less in the first year, so keep practising and building projects.",
   "What does a developer write?", "Code that makes websites and apps work", "Medicine prescriptions; Railway timetables by hand"),
  ("वेब डेवलपर और डिज़ाइनर क्या करते हैं?",
   "वेब या ऐप डेवलपर वह कोड लिखता है जिससे वेबसाइट और फ़ोन ऐप चलते हैं। ग्राफ़िक या डिजिटल डिज़ाइनर पोस्टर, ऐप और वेबसाइट का रूप बनाता है। दोनों एक अच्छे छोटे कोर्स और अपने बनाए काम के छोटे पोर्टफ़ोलियो से शुरू कर सकते हैं, और BCA या डिज़ाइन कोर्स से मदद मिलती है। नियोक्ता सिर्फ़ अंक नहीं, आप क्या दिखा सकते हैं यह देखते हैं। शुरुआत में पहले साल कमाई आमतौर पर कम होती है, इसलिए अभ्यास करते रहें और प्रोजेक्ट बनाते रहें।",
   "डेवलपर क्या लिखता है?", "वह कोड जिससे वेबसाइट और ऐप चलते हैं", "दवा की पर्चियाँ; हाथ से रेल का समय-सारणी"),
  ("वेब डेव्हलपर आणि डिझायनर काय करतात?",
   "वेब किंवा ॲप डेव्हलपर असा कोड लिहितो ज्यामुळे वेबसाइट आणि फोन ॲप चालतात. ग्राफिक किंवा डिजिटल डिझायनर पोस्टर, ॲप आणि वेबसाइटचे रूप तयार करतो. दोघेही एका चांगल्या छोट्या कोर्सने आणि स्वतः बनवलेल्या कामाच्या छोट्या पोर्टफोलिओने सुरुवात करू शकतात, आणि BCA किंवा डिझाइन कोर्सची मदत होते. नियोक्ते फक्त गुण नाही, तुम्ही काय दाखवू शकता ते पाहतात. सुरुवातीला पहिल्या वर्षी कमाई साधारणपणे कमी असते, म्हणून सराव करत राहा आणि प्रकल्प बनवत राहा.",
   "डेव्हलपर काय लिहितो?", "वेबसाइट आणि ॲप चालवणारा कोड", "औषधांच्या चिठ्ठ्या; हाताने रेल्वेचे वेळापत्रक")),
 ("G09", "electrical", "CAR60; CAR61", "electrical; environment; technology; vehicles",
  ("What do solar and EV technicians do?",
   "A solar plant technician checks, cleans and repairs solar panels and the wiring that connects them to the grid. An EV technician services electric vehicles: the battery, motor and charging system. Both build on basic electrical skills, so an ITI Electrician or a diploma is a good start, followed by a short specialised course. Safety is the first rule, because batteries and panels carry high voltage. These fields are growing as more homes and vehicles go electric.",
   "What is the first rule when working on solar panels and EV batteries?", "Safety, because of high voltage", "Speed, because it saves time; Never wear protective gear"),
  ("सोलर और EV तकनीशियन क्या करते हैं?",
   "सोलर प्लांट तकनीशियन सोलर पैनलों और उन्हें ग्रिड से जोड़ने वाली वायरिंग की जाँच, सफ़ाई और मरम्मत करता है। EV तकनीशियन इलेक्ट्रिक गाड़ियों की सर्विस करता है: बैटरी, मोटर और चार्जिंग सिस्टम। दोनों काम बुनियादी बिजली के हुनर पर टिके हैं, इसलिए ITI इलेक्ट्रीशियन या डिप्लोमा अच्छी शुरुआत है, फिर कोई छोटा विशेष कोर्स। सुरक्षा पहला नियम है, क्योंकि बैटरी और पैनल में ऊँचा वोल्टेज होता है। जैसे-जैसे ज़्यादा घर और गाड़ियाँ बिजली से चलेंगी, ये क्षेत्र बढ़ेंगे।",
   "सोलर पैनल और EV बैटरी पर काम करते समय पहला नियम क्या है?", "सुरक्षा, क्योंकि ऊँचा वोल्टेज होता है", "जल्दी, क्योंकि समय बचता है; सुरक्षा उपकरण कभी न पहनना"),
  ("सोलर आणि EV तंत्रज्ञ काय करतात?",
   "सोलर प्लांट तंत्रज्ञ सोलर पॅनेल आणि त्यांना ग्रिडशी जोडणाऱ्या वायरिंगची तपासणी, स्वच्छता आणि दुरुस्ती करतो. EV तंत्रज्ञ इलेक्ट्रिक वाहनांची सर्व्हिस करतो: बॅटरी, मोटर आणि चार्जिंग यंत्रणा. दोन्ही कामे मूलभूत विजेच्या कौशल्यावर आधारित आहेत, म्हणून ITI इलेक्ट्रिशियन किंवा डिप्लोमा ही चांगली सुरुवात आहे, मग एखादा छोटा विशेष कोर्स. सुरक्षितता हा पहिला नियम आहे, कारण बॅटरी आणि पॅनेलमध्ये उच्च व्होल्टेज असते. जसजशी जास्त घरे आणि वाहने विजेवर चालतील तसतशी ही क्षेत्रे वाढतील.",
   "सोलर पॅनेल आणि EV बॅटरीवर काम करताना पहिला नियम कोणता?", "सुरक्षितता, कारण उच्च व्होल्टेज असते", "घाई, कारण वेळ वाचतो; सुरक्षा साधने कधीही न वापरणे")),
 ("G10", "vehicles", "CAR62; CAR63; CAR66", "driving; logistics; organising; teamwork",
  ("How do goods reach us? Jobs in logistics",
   "Every parcel and every shop item travels through logistics. Warehouse associates receive, store and pack goods. Drivers carry them by truck or van, and delivery partners bring them to your door. You need a valid driving licence for driving jobs, and a heavy vehicle licence for trucks. Gig delivery pay can change from week to week with the number of orders, so plan your expenses carefully. Reliability, safety and being on time are what employers value most.",
   "What do you need to drive a heavy truck legally?", "A valid heavy vehicle licence", "Only a school certificate; Nothing, if the road is short"),
  ("सामान हम तक कैसे पहुँचता है? लॉजिस्टिक्स के काम",
   "हर पार्सल और दुकान की हर चीज़ लॉजिस्टिक्स से होकर आती है। वेयरहाउस सहायक सामान लेते, रखते और पैक करते हैं। ड्राइवर उसे ट्रक या वैन से ले जाते हैं और डिलीवरी पार्टनर आपके दरवाज़े तक लाते हैं। ड्राइविंग के काम के लिए वैध ड्राइविंग लाइसेंस चाहिए, और ट्रक के लिए भारी वाहन का लाइसेंस। गिग डिलीवरी की कमाई ऑर्डर की संख्या के साथ हफ़्ते-दर-हफ़्ते बदल सकती है, इसलिए ख़र्च सोच-समझकर बनाएँ। भरोसेमंद होना, सुरक्षा और समय पर पहुँचना नियोक्ता सबसे ज़्यादा पसंद करते हैं।",
   "भारी ट्रक क़ानूनी रूप से चलाने के लिए क्या चाहिए?", "वैध भारी वाहन लाइसेंस", "सिर्फ़ स्कूल का प्रमाणपत्र; रास्ता छोटा हो तो कुछ नहीं"),
  ("सामान आपल्यापर्यंत कसे पोहोचते? लॉजिस्टिक्समधील कामे",
   "प्रत्येक पार्सल आणि दुकानातील प्रत्येक वस्तू लॉजिस्टिक्समधून येते. वेअरहाउस सहायक माल घेतात, साठवतात आणि पॅक करतात. चालक तो ट्रक किंवा व्हॅनने नेतात आणि डिलिव्हरी पार्टनर तुमच्या दारापर्यंत आणतात. वाहन चालवण्याच्या कामासाठी वैध ड्रायव्हिंग लायसन्स लागते, आणि ट्रकसाठी जड वाहनाचे लायसन्स. गिग डिलिव्हरीची कमाई ऑर्डरच्या संख्येनुसार आठवड्या-आठवड्याला बदलू शकते, म्हणून खर्चाचे नियोजन काळजीपूर्वक करा. विश्वासार्हता, सुरक्षितता आणि वेळेवर पोहोचणे हे नियोक्ते सर्वात जास्त महत्त्व देतात.",
   "जड ट्रक कायदेशीररीत्या चालवण्यासाठी काय लागते?", "वैध जड वाहन लायसन्स", "फक्त शाळेचे प्रमाणपत्र; रस्ता छोटा असेल तर काहीच नाही")),
 ("G11", "business", "CAR64; CAR65", "customer service; talking to people; cooking; sales",
  ("What is it like to work in a hotel or a shop?",
   "Hotels, restaurants and stores are built around people. In a hotel you may work at the front desk, in the kitchen or serving guests. In a shop you help customers choose, handle billing and keep shelves stocked. You can start after Class 10 or 12, and a hotel management certificate or diploma helps for hotel jobs. Good manners, a neat appearance and speaking with customers in their own language matter most. With experience you can become a supervisor or manager.",
   "What matters most when serving customers?", "Good manners and clear, friendly talk", "Ignoring complaints; Speaking only when asked twice"),
  ("होटल या दुकान में काम कैसा होता है?",
   "होटल, रेस्तराँ और दुकानें लोगों के इर्द-गिर्द चलती हैं। होटल में आप फ़्रंट डेस्क पर, रसोई में या मेहमानों को परोसने का काम कर सकते हैं। दुकान में आप ग्राहकों को चुनने में मदद करते हैं, बिलिंग संभालते हैं और शेल्फ़ भरे रखते हैं। आप दसवीं या बारहवीं के बाद शुरू कर सकते हैं, और होटल की नौकरी के लिए होटल मैनेजमेंट का सर्टिफ़िकेट या डिप्लोमा मदद करता है। अच्छा व्यवहार, साफ़-सुथरा रूप और ग्राहकों से उनकी भाषा में बात करना सबसे ज़रूरी है। अनुभव के साथ आप सुपरवाइज़र या मैनेजर बन सकते हैं।",
   "ग्राहकों की सेवा में सबसे ज़रूरी क्या है?", "अच्छा व्यवहार और साफ़, मित्रवत बात", "शिकायतें अनदेखी करना; दो बार कहने पर ही बोलना"),
  ("हॉटेल किंवा दुकानात काम कसे असते?",
   "हॉटेल, रेस्टॉरंट आणि दुकाने माणसांभोवती चालतात. हॉटेलमध्ये तुम्ही फ्रंट डेस्कवर, स्वयंपाकघरात किंवा पाहुण्यांना वाढण्याचे काम करू शकता. दुकानात तुम्ही ग्राहकांना निवडण्यात मदत करता, बिलिंग सांभाळता आणि शेल्फ भरलेले ठेवता. तुम्ही दहावी किंवा बारावीनंतर सुरू करू शकता, आणि हॉटेलच्या नोकरीसाठी हॉटेल मॅनेजमेंटचे प्रमाणपत्र किंवा डिप्लोमा मदत करतो. चांगली वागणूक, नीटनेटके रूप आणि ग्राहकांशी त्यांच्या भाषेत बोलणे सर्वात महत्त्वाचे आहे. अनुभवाने तुम्ही पर्यवेक्षक किंवा व्यवस्थापक होऊ शकता.",
   "ग्राहकांना सेवा देताना सर्वात महत्त्वाचे काय?", "चांगली वागणूक आणि स्पष्ट, मित्रत्वाचे बोलणे", "तक्रारींकडे दुर्लक्ष करणे; दोनदा सांगितल्यावरच बोलणे")),
]

wb = openpyxl.load_workbook(PATH)
ws = wb["Lessons"]
have = {r[0].value for r in ws.iter_rows(min_row=2)}
for lid, topic, cars, tags, en, hi, mr in LESSONS:
    if lid in have:
        continue
    ws.append([lid, topic, cars, tags, *en, *hi, *mr, STATUS])
    print("added", lid)
wb.save(PATH)
