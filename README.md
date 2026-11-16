# Raah · राह

**Other platforms tell a rural student what to become. Raah also tells them what it costs, how they'll pay, and when it pays back.**

Raah is a voice-first, offline-first career guide for students from Class 9 to graduation in rural Maharashtra, built for the Citi Ada Lovelace Hackathon. A student talks to it in Marathi, Hindi or English, gets a shortlist of careers that includes vocational and self-employment options, and sees a full money plan for each path: total cost, what scholarships and stipends cover, expected income, and the month the investment pays back. Teachers get a class dashboard with dropout-risk and talent flags, and the money layer turns scholarship payouts into ISO 20022 payment instructions.

The pilot district is Pune.

<p align="center">
  <img src="docs/screenshots/home.png" width="230" alt="Home screen with language picker and icon tiles">
  <img src="docs/screenshots/payback-card.png" width="230" alt="Cost and payback card for ANM nursing">
  <img src="docs/screenshots/compare.png" width="230" alt="Side-by-side comparison of ANM nursing and ITI electrician">
</p>

---

## Contents

- [Core idea: the AI explains, the data decides](#core-idea-the-ai-explains-the-data-decides)
- [Features](#features)
- [Screens](#screens)
- [The spreadsheet drives everything](#the-spreadsheet-drives-everything)
- [How the numbers are calculated](#how-the-numbers-are-calculated)
- [Sign-in and roles](#sign-in-and-roles)
- [AI conversation](#ai-conversation)
- [Ask Raah (RAG over the dataset)](#ask-raah-rag-over-the-dataset)
- [Architecture](#architecture)
- [Run it locally](#run-it-locally)
- [API](#api)
- [Project structure](#project-structure)
- [Adding a language, a scheme or a career](#adding-a-language-a-scheme-or-a-career)
- [Tests](#tests)
- [Data sources](#data-sources)
- [Licence](#licence)

---

## Core idea: the AI explains, the data decides

Eligibility, costs, payback months, distances and career ranking are computed by plain code from a curated dataset (`raah-dataset.xlsx`). Language models and voice are only used to talk, collect the profile and explain results. Every figure on screen carries a link to the page it came from and the date it was checked.

## Features

### Student

| Feature | What it does |
|---|---|
| **Language picker + icon home** | Marathi, Hindi, English. Big icon tiles for Discover, Careers, Learn, Opportunity, Scholarships and Compare. |
| **Discover chat** | When a language model is reachable, Raah holds a free conversation ("I'm Asha, 15, in Class 10 and I like computers") and shows the fields it understood as chips under each reply. Otherwise, or with one tap, it asks 12 short scripted questions (name, age, class, interests, marks, taluka, category, family income, travel limit, hostel, documents). Answer chips for low-literacy use; mic on every question. |
| **Why this career** | Each shortlisted career gets a one or two sentence reason. The model writes it from the score breakdown and dataset rows; if its text contains a number that is not in those rows, the template sentence is shown instead. |
| **Parental consent** | Students under 18 need a parent's OTP before the profile is saved. A consent record with purpose and timestamp is stored (DPDP Act 2023). |
| **Career shortlist** | Top 5 out of 40 careers, scored on interest match (50%), eligibility (20%), affordability (20%) and local demand (10%). The top 5 always includes at least one vocational and one non-STEM or self-employment option. |
| **Cost & payback card** | Course fees, exam fees, materials, travel or hostel, scholarship cover, stipend while training, net family cost, monthly income range and the payback month at typical and low income. |
| **What-if planner** | Toggle the scholarship, pick which scheme counts, move the commute slider, switch to hostel, set a monthly family contribution, or compare against leaving school for daily-wage work. Recalculates instantly, offline. |
| **Side-by-side compare** | Any two paths in two columns plus a cumulative cash chart with break-even marked. |
| **Scholarship check** | 17 central and Maharashtra schemes checked rule by rule (✅ ❌ ❔ 📄). Names the missing document and where to get it (tehsil office, Aaple Sarkar Seva Kendra, school). |
| **Nearest training centres** | 3 nearest Govt ITIs or nursing schools for the chosen path on a Leaflet / OpenStreetMap map with the student's home, plus distance, fees and source. Offline the map is hidden and the list still works. Centres without exact coordinates sit at their taluka point and are marked approximate. |
| **Parent voice note** | A short message for parents in the chosen language with the plan's numbers, played aloud and shareable on WhatsApp as text or as an audio file. With BHASHINI keys the file is generated speech (WAV); without them the student records the message in their own voice. On phones the file goes to the share sheet (WhatsApp, Bluetooth, Files); elsewhere it downloads. |
| **Audio lessons + quiz** | "What is an ITI?", "What is an apprenticeship?", "How do scholarships work?" plus a 5-question quiz. Facts inside lessons and quiz (stipend rates, income limits, ITI count) come from the dataset. With BHASHINI keys, "Save lesson audio for offline" stores each lesson as an audio file on the phone; the file is tied to the exact lesson text, so after a dataset edit the new figures are spoken rather than an old recording. Without keys the phone's own voice reads them, which also works offline. |
| **Apprenticeships** | 31 live NAPS listings in Pune district and 17 Central Railway seat lines, searchable, with stipend and apply link. |
| **Exams** | Every entrance test or admission round a path needs shows as a step on the plan screen, and the Exams screen lists them all with who can apply, how selection works, the fee for open and reserved categories, when to apply and the official site. All of it comes from the `Exams` sheet. |
| **Mentors** | Mentors from the `Mentors` sheet, filtered by the student's top careers (or any career) and a distance slider. A mentor's phone number never leaves the server until the student agrees to share their first name, class and taluka with that mentor; the teacher sees who connected with whom. |
| **Teacher modules** | Short lessons made by teachers, read aloud in the module's language, with a quiz. Free, per-module or monthly subscription; payments are simulated. |
| **Offline + sync** | Installable PWA. Dataset, profile, plan, lessons and quiz answers work offline; queued actions sync on reconnect with a "N changes synced" toast. |
| **Delete my data** | One tap clears everything stored on the phone. |
| **Teacher recommendations** | When a teacher recommends a scheme, the student sees it on the home screen with the plan it was for and any missing document. "Check" opens the scholarship screen with that scheme first. Cached on the phone so it still shows offline. |

<p align="center">
  <img src="docs/screenshots/mentors.png" width="240" alt="Mentors filtered by career and distance, one number revealed after consent">
  <img src="docs/screenshots/student-module.png" width="240" alt="Student completing a teacher's Marathi module">
</p>

<p align="center">
  <img src="docs/screenshots/module-builder.png" width="240" alt="Teacher module builder with quiz and price model">
  <img src="docs/screenshots/teacher-earnings.png" width="240" alt="Teacher earnings paid out as pain.001">
</p>

<p align="center"><img src="docs/screenshots/exams.png" width="240" alt="Exams screen with ITI admission and polytechnic details"></p>

<p align="center"><img src="docs/screenshots/lessons-offline.png" width="240" alt="Audio lessons saved on the phone for offline listening"></p>

<p align="center"><img src="docs/screenshots/parent-voice-note.png" width="240" alt="Message for parents with a recorded voice note ready to share"></p>

<p align="center"><img src="docs/screenshots/teacher-recommendation.png" width="240" alt="Home screen with a scholarship recommendation from the teacher"></p>

### Teacher

| Feature | What it does |
|---|---|
| **Class dashboard** | 40 students with profile completion, top interests and each student's best-fit career. |
| **Dropout-risk flags** | Logistic regression (scikit-learn) with the top two reasons per student, e.g. "attendance fell 26% this term; an older sibling already left school to work". Trained on a synthetic class. |
| **Talent flags** | High quiz score with strong marks. |
| **Recommend to all eligible** | Pick a scheme and a path, see how many students qualify (and how many still need a document), send to all in one tap. Students who signed up and saved a profile are checked with the same rules as the demo class and receive the recommendation in their app. |
| **Module builder** | Title, language, lesson text (spoken to students), up to 10 quiz questions with the correct answer marked, and a price model: free, per module or monthly subscription. |
| **Earnings** | The teacher's share of module sales and a fixed amount per completed enrolment, both set in the `Assumptions` sheet (`teacher_share_of_module_sales`, `payout_per_completed_enrolment`). "Pay out" sends everything unpaid as one ISO 20022 pain.001 teacher payout. |

### Money layer (sandbox)

| Feature | What it does |
|---|---|
| **Family bank check** | Account Aggregator style consent, synthetic deposit data in the ReBIT FI schema, then: account active, income band matches declared income, ready for DBT. |
| **ISO 20022 payouts** | Scholarship, stipend and teacher payouts generated as `pain.001.001.09` XML with a viewer, validation and an initiated → accepted → credited ledger. The scholarship amount is read from the dataset. |
| **Skills passport** | Completed lessons and quiz scores issued as a signed W3C Verifiable Credential / Open Badge JSON. |
| **Partner APIs** | OAuth2 client-credentials for employers, colleges and NGOs: post opportunities, see anonymised candidates (contacts hidden until the student accepts), mark enrolments complete to trigger a teacher payout. |

## Screens

| Discover | Careers | What-if |
|---|---|---|
| <img src="docs/screenshots/discover.png" width="240"> | <img src="docs/screenshots/careers.png" width="240"> | <img src="docs/screenshots/what-if.png" width="240"> |

| Scholarship check | Parent voice note | Marathi |
|---|---|---|
| <img src="docs/screenshots/eligibility.png" width="240"> | <img src="docs/screenshots/parent-note.png" width="240"> | <img src="docs/screenshots/marathi.png" width="240"> |

| Learn | Teacher dashboard | Money layer |
|---|---|---|
| <img src="docs/screenshots/learn.png" width="240"> | <img src="docs/screenshots/teacher.png" width="240"> | <img src="docs/screenshots/money.png" width="240"> |

| Data sources |
|---|
| <img src="docs/screenshots/data.png" width="240"> |

## The spreadsheet drives everything

All figures are loaded from `raah-dataset.xlsx` at runtime. Editing a cell and saving updates the app within a few seconds, with no rebuild or restart.

1. `backend/raah/dataset.py` reads every sheet and converts text cells into numbers, for example `≤ ₹3,50,000 per year` → `350000`, `₹8,200-20,000/month` → `{low: 8200, high: 20000}`, `₹24,217 (male) / ₹18,353 (female)` → a value per gender, `Boys: 50% tuition; Girls: 100%` → fee share per gender.
2. The parsed data is cached and re-read whenever the file's modified time changes.
3. The app polls `/api/version` every 4 seconds and recalculates when the spreadsheet is saved, with a "Spreadsheet updated" toast.
4. Cells that cannot be converted are listed on the **Data sources** screen.
5. The phone keeps the last copy in IndexedDB for offline use.

### Dataset sheets

| Sheet | Used for |
|---|---|
| `Scholarships` | Scheme names, income limits, amounts, documents, apply links. The income limit and amount cells feed the rules and payback maths directly. |
| `Careers_Income` | 40 careers with income while training and after training. Row `CAR40` (casual daily wage) is the "dropping out" baseline. `Earnings group` links a row of `Occupation_Earnings`; `Pay year 1 / 3 / 5` hold official pay-scale steps (7th CPC pay matrix, Agnipath package); `Income status` says "Sourced ..." or "Estimate ...", and estimates get an amber badge in the app. A ₹ figure typed into the income cell overrides the link. |
| `Occupation_Earnings` | PLFS 2025 average monthly earnings for regular-wage employees by occupation division (craft trades, machine operators, clerical, service & sales, technicians, professionals) and for graduates, plus self-employed earnings by industry; men / women / everyone, all India / rural / urban. Electrician and welder share the craft-trades row: PLFS does not publish single trades. |
| `Apprenticeships_NAPS`, `Apprenticeships_Railway` | Opportunity screen. |
| `Stipend_Rates` | Minimum apprentice stipends used in lessons and quiz. |
| `Training_Centres` | Nearest-centre lookup. |
| `Courses` | Free courses per career; a course's fee can fill a plan's fee. |
| `Mentors` | Synthetic demo mentors with career IDs, taluka, languages, what they help with and a phone number that is only revealed after the student accepts. |
| `Exams` | Entrance tests and admission rounds: ITI admission (DVET), polytechnic (DTE), MHT-CET, MH Nursing CET, NEET-UG, NMMS and the Central Railway apprentice notice, with who can apply, selection, application fee by category, last cycle dates, usual timing and official site. |
| `Assumptions` | Fare per km, study days per year, hostel cost per month, working days per month, low/high income factors, payback horizon, whether scholarships can be combined, months a monthly allowance is paid. |
| `Plan_Inputs` | One row per career path: course months, months earning while training, fees, exam fees, materials, course tags, centre type and the exams on the path (`EX01; EX07`). Blank income cells are taken from `Careers_Income`. |
| `Eligibility_Rules` | One row per rule. `@income` in the Value column links to that scheme's income limit in `Scholarships`. Operators: `in`, `any`, `has`, `is`, `<=`, `<`, `>=`, `>`. Category relaxations: `55; SC=50; ST=50`. |
| `Career_Profile` | Interest tags, minimum class and local demand per career, used for ranking. |
| `Talukas` | Taluka points used for distance while a centre has no Lat/Lon. Exact centre coordinates take priority once filled in. |
| `Demo_Students` | Hero profiles for the demo (Priya, Rohan, Sana). |

`backend/scripts/add_app_sheets.py` adds the app sheets to a workbook that does not have them yet and never overwrites a sheet that already exists. `backend/scripts/add_income_detail.py` adds `Occupation_Earnings` and the per-career income columns the same way (it only fills empty cells).

## How the numbers are calculated

```
total_cost    = course_fees + exam_fees + materials
              + commute_km × 2 × fare_per_km × study_days_per_year × years      (or hostel_cost_per_month × months)
scholarship   = best eligible scheme (or the sum, if stack_scholarships = 1):
                fee share × fees (capped where the scheme has a cap)
              + per-year amount × years
              + per-month amount × months_paid_per_year × years
stipend       = lowest listed stipend × months earning while training
net_cost      = total_cost − scholarship − stipend
income(month)  = year-1 income, grown along the Pay year 1 → 3 → 5 steps when the career has them
                 (straight line between steps, flat after the last one), otherwise flat
monthly_gain  = income(month) (typical or low) − baseline   baseline = 0 for a student, or PLFS daily wage × working days
payback       = first month after training where cumulative gain ≥ net_cost
```

- Income uses the student's gender where the source splits it (PLFS male / female averages).
- Which income a career uses, in order: your figure in `Plan_Inputs` → its `Occupation_Earnings` row (typical = all-India average, low / high = the rural and urban averages) → its official pay steps (fixed pay, so low = typical = high) → its own published range (e.g. GDS TRCA) → a single figure × `income_low_factor` / `income_high_factor`, shown as an estimate.
- Scholarship values use the lower end of a range so the payback is never overstated; the upper end is shown alongside.
- A scheme counts as eligible for the plan when every rule passes or the only gap is a document the student can still get.

## Sign-in and roles

Students and teachers sign in with their mobile number and a one-time password.

<p align="center"><img src="docs/screenshots/login.png" width="240" alt="Register screen with name, mobile number and PIN"></p>

| | Student | Teacher |
|---|---|---|
| Who can register | Anyone with a 10-digit Indian mobile number | Only numbers listed in `RAAH_TEACHER_PHONES` |
| Screens | Discover, Careers, plans, Compare, Scholarships, Learn, Opportunity, Profile | Everything a student sees, plus Class dashboard and Money |
| Server access | Own profile, own synced activity, own AA consent | Class data, bulk recommend, pain.001 payouts and ledger, any consent |

- **Register, then sign in:** the first screen has **Register** (full name, mobile number, PIN typed twice) and **Sign in** (mobile number and PIN). After registering, the app moves to Sign in with the number filled in. After signing in, the home screen and the Discover chat greet the person by the name they registered with; demo students are never used as a student's identity (teachers can still preview them).
- **Why a PIN, not a password:** most users type on a phone number pad, often in Marathi or Hindi. A 4 to 6 digit PIN works the same in every language and is familiar from ATM and UPI. Easy PINs (`1111`, `1234`, `9876`) are refused.
- **PIN storage and lockout:** PINs are hashed with Argon2id (never stored or logged in plain text). 5 wrong PINs lock the account for 15 minutes; a correct PIN resets the count.
- **Forgot PIN:** the teacher enters the student's number under "Student forgot their PIN" on the Class dashboard. That clears the PIN and the student registers again with the same number; their saved profile stays.
- **Tokens:** HS256 JWT signed with `RAAH_SIGNING_KEY`, carrying the user id, role and registered name, valid for `RAAH_TOKEN_TTL_DAYS` (default 30) so a signed-in student keeps working offline. A rejected token signs the app out.
- **Database:** PostgreSQL. The app reads `DATABASE_URL` from `backend/.env` and will not start without it. The schema lives in `backend/raah/db.py` and is created on startup; columns added later are added to an existing database automatically.
- **Profile sync:** profile edits and offline actions are queued on the phone and saved to the account on reconnect; signing in on a new phone restores the profile.
- **Delete my data:** removes the account, profile and synced activity on the server and clears the phone.
- **Open endpoints:** `/api/data`, `/api/version`, `/api/plan`, `/api/eligibility`, `/api/careers` and `/api/centres` stay public because they only serve the published dataset and run the same maths the phone runs offline.
- **Partners** use a separate OAuth2 client-credentials flow (below).

Try it: register as a student with any mobile number. To try the teacher screens, register as a teacher with `9000000001` (the default `RAAH_TEACHER_PHONES`).

## AI conversation

<p align="center">
  <img src="docs/screenshots/ai-chat.png" width="240" alt="Discover chat with fields understood by the model shown as chips">
  <img src="docs/screenshots/ai-explain.png" width="240" alt="Career shortlist with model-written reasons">
</p>

Raah uses open-source models through any OpenAI-compatible chat API. Providers are tried in the order set in `LLM_PROVIDERS`; one that fails is skipped for 60 seconds so a stopped local server does not slow the app.

| Provider | Model (default) | Variables |
|---|---|---|
| `ollama` | `gemma4:12b`, running on your own machine | `OLLAMA_URL`, `OLLAMA_MODEL` |
| `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY`, `GROQ_MODEL` |
| `sarvam` | `sarvam-m` (Indian languages) | `SARVAM_API_KEY`, `SARVAM_MODEL` |

**Profile extraction** (`POST /api/chat/turn`). The model gets the conversation, the profile so far, the fields still missing and the allowed values (categories, talukas and interest tags from the spreadsheet). It replies with its next question and the fields it learned. Every field is validated on its own with Pydantic: an age of 40, marks of 300 or an unknown category is dropped and reported in `rejected`, while the valid fields are kept. Talukas and interests are matched to the spreadsheet's names. The model is told never to state fees or amounts.

**Grounded reasons** (`POST /api/chat/explain`). The server ranks careers with the same engine as the app, then gives the model only that career's facts: score breakdown, matched interests, entry path, net cost and payback from the dataset. Every number in the model's answer must appear in those facts, otherwise the template reason is returned.

**Interest matching** (`POST /api/interests/match`). Students describe what they enjoy in their own words and language, for example "मला गाड्या दुरुस्त करायला आवडतं" (I like repairing vehicles). A multilingual embedding model maps the sentence to the closest career tags in the spreadsheet, here "fixing things" and "vehicles"; the matched tags appear as chips under the answer. Ranking still runs on tags, so it stays identical online and offline. Providers are tried in the order of `EMBED_PROVIDERS`: Ollama's `/api/embed` with `bge-m3` (run `ollama pull bge-m3` once), then `sentence-transformers` with `intfloat/multilingual-e5-small` if that package is installed. Without either, words are matched against the tags. Tag embeddings are cached per model and per tag list, so a tag edited in the spreadsheet is embedded again on the next request.

<p align="center"><img src="docs/screenshots/interest-matching.png" width="240" alt="A Marathi answer mapped to the tags fixing things and vehicles"></p>

**Fallback.** With no provider reachable, offline, or when the student taps "Use quick questions instead", the scripted questions take over and skip whatever the conversation already filled in. Nothing else in the app depends on a model.

To use your local Ollama:

```bash
ollama pull gemma4:12b
# backend/.env
LLM_PROVIDERS=ollama
OLLAMA_MODEL=gemma4:12b
```

## Ask Raah (RAG over the dataset)

Students, parents and teachers can ask free questions on the **Ask Raah** screen, in Marathi, Hindi or English: "Which scholarship helps an OBC girl with hostel costs?", "पुण्यात रेल्वे अप्रेंटिसचे कोणते ट्रेड आहेत?". The answer comes only from the spreadsheet, and every fact carries a numbered citation to the sheet, row ID, Excel row and official source link (`backend/raah/rag.py`, `POST /api/ask`).

<p align="center"><img src="docs/screenshots/ask-raah.png" width="240" alt="Ask Raah answering with numbered citations to Scholarships rows SCH16 and SCH02"></p>

**Ingestion** (on start, and again whenever the spreadsheet or a knowledge file is saved)
1. **Chunk.** Every sheet row is one chunk. Its section path is `<Sheet> > <row ID>` (for example `Scholarships > SCH16`), and its Excel row number and Source link travel with it. A scheme's eligibility rules are grouped into one chunk; the README sheet is one chunk. `Demo_Students` and `Talukas` are skipped, and mentor phone numbers never enter the index. Optional `.md` / `.txt` files in `backend/knowledge/` are split by heading, keep their heading path, and a table always stays whole.
2. **Embed.** The same multilingual model as interest matching (Ollama `bge-m3`, else `sentence-transformers`). Vectors are cached by text hash in `backend/data/rag_vectors.json`, so a re-index only embeds rows that changed.
3. **Store.** In memory by default: a pure-Python BM25 keyword index plus a cosine vector index, so `./run.sh` needs nothing extra. Set `WEAVIATE_URL` to also push the chunks and vectors to Weaviate and let it run the hybrid query.

**Question time**
4. **Hybrid search.** 70% vector meaning + 30% BM25 keywords (`RAG_ALPHA=0.7`), scores min-max normalised first, top 6 chunks (`RAG_TOP_K`). BM25 catches exact codes such as `SCH05` or an establishment code like `E06242700019`. Because the row text is English, a Marathi or Hindi question also gets English keywords for the BM25 half: from a small built-in word list, plus an LLM rewrite when a model answers. A follow-up question is searched together with the previous one.
5. **Answer.** The LLM gets the numbered chunks and the student's class, category, income and taluka, answers only from them, and cites `[n]`.
6. **Data decides.** Every number in the answer (Devanagari digits included) must appear in the retrieved chunks, the question or the profile. If not, or if no model is running, the app shows the top matching rows with their sources instead, and says why. If nothing matches, it says the data does not have it.

**Why not Weaviate by default:** the dataset is about 270 chunks, which the in-memory index searches in milliseconds; Embedded Weaviate does not run on Windows; and Docker would make the laptop demo depend on one more service. The Weaviate path is there for when the corpus grows (more scholarships, documents):

```bash
docker run -p 8080:8080 -e DEFAULT_VECTORIZER_MODULE=none -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true cr.weaviate.io/semitechnologies/weaviate:1.30.0
# backend/.env
WEAVIATE_URL=http://localhost:8080
```

If Weaviate stops answering, search falls back to the in-memory index for a minute. `GET /api/ask/status` shows the chunk count per sheet, the embedding model and whether vectors are ready.

## Architecture

```
 Phone (low-end Android, Chrome)
 ┌────────────────────────────────────────────┐
 │ Next.js PWA (static export, React, Tailwind)│
 │  · service worker: app shell + dataset      │
 │  · IndexedDB (Dexie): data, profile,        │
 │    consent, quiz answers, sync queue        │
 │  · lib/engine.ts: payback, what-if,         │
 │    eligibility, ranking (offline)           │
 │  · Web Speech API voice fallback            │
 └──────────────────┬─────────────────────────┘
                    │ HTTPS
 ┌──────────────────▼─────────────────────────┐
 │ FastAPI                                     │
 │  /api/data /api/version  parsed spreadsheet │
 │  /api/plan /api/eligibility /api/careers    │
 │  /api/centres            raah/engine.py     │
 │  /api/voice       BHASHINI / Sarvam ASR+TTS │
 │  /api/teacher            class, flags, bulk │
 │  /api/money              AA, pain.001, VC   │
 │  /api/partners           OAuth2 + OpenAPI   │
 └──────────────────┬─────────────────────────┘
                    │
             raah-dataset.xlsx
```

The same logic exists in Python (`backend/raah/engine.py`, used by the API) and TypeScript (`web/lib/engine.ts`, used offline in the browser). A parity test runs both on 105 scenarios and requires identical results.

**Stack:** Next.js 16, React 19, Tailwind CSS 4, Recharts, Dexie · FastAPI, Pydantic, openpyxl, scikit-learn, NumPy, lxml, PyJWT, httpx · BHASHINI (ULCA) and Sarvam AI for Indian-language speech.

## Run it locally

Requirements: Python 3.10+. Node 20+ only if you want to change the web app.

```bash
git clone https://github.com/sanikadeokule/raah-citi-hack.git
cd raah-citi-hack
# once: create the PostgreSQL database (Docker if running, otherwise installs PostgreSQL 16)
powershell -ExecutionPolicy Bypass -File backend\scripts\setup_postgres.ps1   # Windows
./backend/scripts/setup_postgres.sh                                          # Mac / Linux
./run.sh
```

The setup script creates the role `raah` and database `raah` on `localhost:5432` and writes `DATABASE_URL=postgresql://raah:raah@localhost:5432/raah` into `backend/.env`. Running it again is safe. Other settings (BHASHINI keys, signing key, partner credentials) are in the same `.env`.

Open <http://localhost:8000>. On a phone connected to the same Wi-Fi, open `http://<laptop-ip>:8000` and use "Add to Home screen" to install it.

### Phones: use HTTPS for the microphone

Phone browsers only allow the microphone (voice typing, recording a voice note) on `https://` pages, so on the plain `http://<laptop-ip>:8000` link the mic shows a message instead of listening. For a demo, start the app with one of these from the repository root (or `python scripts/serve_https.py [--lan]` from `backend/`, which also works on Windows):

| Command | Link it prints | Needs | Notes |
| --- | --- | --- | --- |
| `./run.sh https` | `https://<random>.trycloudflare.com` | internet | Downloads `cloudflared` into `backend/data/bin` the first time. Any phone, any network, no warning. The link changes each run. |
| `./run.sh lan` | `https://<laptop-ip>:8443` | same Wi-Fi | Self-signed certificate made for the laptop's address. The phone warns once: tap **Advanced → Proceed**. Allow Python through the firewall if Windows asks. |

`pip install qrcode` to also get a QR code in the terminal for the phone to scan.

### PostgreSQL without the script

- **Docker:** `docker compose up -d db` from the repository root starts PostgreSQL 16 with the same role, password and database.
- **Hosted (Neon, Supabase, RDS):** paste the connection string as `DATABASE_URL` in `backend/.env`. `postgres://` URLs work as they are.

Tables are created on first start. Use a strong password instead of `raah` anywhere other than your own laptop.

By default the backend looks for `raah-dataset.xlsx` in the repository root or the folder above it. Point it anywhere with `RAAH_DATASET=/path/to/raah-dataset.xlsx`.

### Working on the web app

```bash
cd web
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev    # http://localhost:3000 with hot reload
npm run build                                             # writes web/out, which the backend serves
```

### Voice

Speech runs on the server when keys are set in `backend/.env`, so Marathi works even on phones that have no Marathi voice installed:

- **BHASHINI** (`BHASHINI_USER_ID`, `BHASHINI_API_KEY`), the government ULCA pipeline.
- **Sarvam AI** (`SARVAM_API_KEY`): Bulbul for text-to-speech, Saarika for speech-to-text.

`VOICE_PROVIDERS` (default `bhashini,sarvam`) sets the order. A provider without keys is skipped, and one that fails is tried last for two minutes, so a slow service does not hold up every request. `GET /api/voice/status` shows which providers are active. Generated speech is cached on the server in `RAAH_TTS_CACHE` (default `backend/data/tts`), so each lesson or message is synthesised once and cached audio still plays if the keys or the service go away; lesson audio can also be saved on the phone for offline listening.

Without keys the app uses the phone's own voices (`mr-IN`, `hi-IN`, `en-IN`) and the browser's speech recognition. If the phone has no Marathi voice, a Hindi voice reads Marathi text (same script). When something cannot work, the app says why instead of staying silent: the page is not on https, microphone permission is blocked, no microphone, nothing heard, no voice for the language, or audio could not play on the device (for example a desktop with no speakers). The speaker button turns into ⚠️ and can be tapped to try again.

### ISO 20022 validation

Run `python scripts/fetch_iso_schema.py` from `backend/` once. It downloads the official `pain.001.001.09.xsd` from the ISO 20022 message catalogue into `backend/schemas/` and checks its namespace. From then on every generated payment file is validated against the official schema, and the payment response and ledger show `official XSD pain.001.001.09` with any errors by line. If the download is blocked, save the file there by hand (or point `RAAH_PAIN001_XSD` at it). Without the file, structural checks run instead.

## API

Interactive OpenAPI docs: <http://localhost:8000/docs>

| Method & path | Purpose |
|---|---|
| `GET /api/data` | Whole parsed dataset (ETag-cached) |
| `GET /api/version` | Spreadsheet modified time, polled for live reload |
| `POST /api/plan` | Cost & payback for `{profile, plan_id, options}` |
| `POST /api/eligibility` | Rule-by-rule results for a profile, optionally for a plan |
| `POST /api/careers` | Top-N careers with score breakdown and reason |
| `POST /api/centres` | Nearest centres of a type |
| `GET /api/voice/status`, `POST /api/voice/tts`, `/api/voice/asr` | Speech through BHASHINI, then Sarvam |
| `GET /api/teacher/class` | Class with risk and talent flags |
| `GET /api/teacher/eligible/{scheme}` · `POST /api/teacher/recommend` | Bulk recommend |
| `POST /api/money/aa/consent` · `GET /api/money/aa/fi-data` | Consent and synthetic FI data |
| `POST /api/money/payments` · `GET /api/money/ledger` | pain.001 generation and status |
| `POST /api/money/passport` | Signed skills passport |
| `POST /api/partners/token` | OAuth2 client-credentials token |
| `POST /api/partners/opportunities` · `GET /api/partners/candidates` | Partner posting and masked candidates |
| `POST /api/partners/enrolments/{id}/complete` | Completion → teacher payout |
| `GET /api/chat/status` | Whether a language model is reachable |
| `POST /api/chat/turn` | Next question plus validated profile fields from the conversation |
| `POST /api/interests/match` | Closest career tags for free-text interests in any language |
| `POST /api/ask` · `GET /api/ask/status` | Ask Raah: hybrid search over the spreadsheet rows and a cited, number-checked answer |
| `POST /api/chat/explain` | Model-written match reason, checked against the dataset's numbers |
| `POST /api/mentors/{id}/request` · `GET /api/mentors/mine` · `GET /api/mentors/requests` | Accept-to-reveal mentor contact; teacher view of connections |
| `POST /api/modules` · `GET /api/modules/mine` · `GET /api/modules/earnings` · `POST /api/modules/earnings/payout` | Teacher module builder, earnings and pain.001 payout |
| `GET /api/modules` · `POST /api/modules/{id}/enrol` · `POST /api/modules/{id}/complete` | Student enrolment and quiz completion |
| `POST /api/auth/register` · `POST /api/auth/login` | Register (name, mobile, PIN, role), then sign in with mobile + PIN to get a JWT |
| `POST /api/auth/reset-pin` | Teacher clears a student's forgotten PIN so they can register again |
| `GET /api/auth/notifications` · `POST /api/auth/notifications/{id}/read` | Recommendations sent to the signed-in student |
| `GET /api/auth/me` · `GET`/`PUT /api/auth/profile` · `DELETE /api/auth/me` | Account, saved profile, delete my data |
| `POST /api/sync` | Actions queued while offline (signed in) |

Example:

```bash
curl -s -X POST localhost:8000/api/plan -H 'Content-Type: application/json' \
  -d '{"profile":{"gender":"F","class":10,"category":"OBC","family_income_annual":180000,"lat":19.2,"lon":73.88,"documents":["caste_certificate","marksheet_10"],"domicile":"Maharashtra"},"plan_id":"PLN03","options":{"commute_km":20}}'
```

## Project structure

```
backend/
  raah/
    dataset.py      spreadsheet loader and text-to-number parsing, reload on save
    engine.py       eligibility, cost & payback, centres, career ranking
    main.py         FastAPI app, core routes, serves web/out
    auth.py         register and sign in with mobile + PIN, JWT roles, profiles
    db.py           PostgreSQL schema and connection (DATABASE_URL)
    rag.py          Ask Raah: row chunks, hybrid BM25 + vector search, cited answers
    voice.py        speech: BHASHINI, then Sarvam (ASR / TTS)
    teacher.py      synthetic class, dropout model, bulk recommend
    money.py        pain.001, Account Aggregator mock, skills passport
    partners.py     OAuth2 partner endpoints
  scripts/add_app_sheets.py
  scripts/add_income_detail.py
  scripts/serve_https.py   https for phones (Cloudflare tunnel or self-signed LAN)
  tests/            parity and spreadsheet-edit tests
web/
  app/              one folder per screen
  components/       shared UI, payback card, what-if, chart, scheme result
  lib/              engine.ts, store (data, profile, sync), db (IndexedDB), lessons
  locales/          en.json, mr.json, hi.json
  public/           service worker, manifest, icon
  out/              prebuilt static export
docs/screenshots/
run.sh
```

## Adding a language, a scheme or a career

- **Language:** copy `web/locales/en.json` to `web/locales/<code>.json`, translate the values, and add the code to `LANGS` in `web/lib/store.tsx`.
- **Scholarship:** add a row to `Scholarships`, then its rules to `Eligibility_Rules` (use `@income` for the income limit). No code change.
- **Career path with a cost plan:** add the career to `Careers_Income` and `Career_Profile`, and a row to `Plan_Inputs`.
- **Training centre coordinates:** fill `Lat` and `Lon` in `Training_Centres`.

## Tests

```bash
cd backend
pip install -r requirements.txt pytest
RAAH_DATASET=../raah-dataset.xlsx python -m pytest -q tests
# against a scratch PostgreSQL database (its tables are emptied at the start of each run; never point this at the real one)
TEST_DATABASE_URL=postgresql://raah:raah@localhost:5432/raah_test python -m pytest -q tests
```

Tests never use the app's `DATABASE_URL`. Without `TEST_DATABASE_URL` they run on a throwaway SQLite file.

- `test_parity.py`: Python and TypeScript engines agree on 105 scenarios (3 students × 7 plans × 5 what-if settings), including eligibility and ranking.
- `test_auth.py`: register then sign in, registered name in the token and `/me`, Argon2 PIN hashing, duplicate and weak-PIN rejection, wrong-PIN countdown and lockout, teacher PIN reset, upgrading an old account, teacher allowlist, role checks on teacher and money endpoints, consent ownership, profile sync and account deletion.
- `test_rag.py`: one chunk per row with path, row and source; tables kept whole in documents; exact codes found; hybrid search; Marathi questions without a model; re-index after a spreadsheet edit; citations; invented numbers rejected; Weaviate path and its fallback.
- `test_data_driven.py`: edits a copy of the spreadsheet (income limit, course fee, income, occupation earnings, assumption) and checks the eligibility, cost, payback and cached data change accordingly.

## Data sources

National Scholarship Portal, MahaDBT, Ministry of Social Justice & Empowerment, Ministry of Education, AICTE, DST INSPIRE, apprenticeshipindia.gov.in (NAPS), RRC Central Railway, DGT stipend notification (Sep 2025), DVET Maharashtra, MSBNPE, PLFS 2025 (MoSPI; occupation-level averages computed from the unit data by India Labour Observatory, CC BY 4.0), 7th CPC pay matrix, PIB, India Post, Skill India Digital Hub, SWAYAM and DIKSHA. Each row in the spreadsheet links to its exact source page and check date.

The teacher's class, the dropout model's training data and the family bank data are synthetic.

## Licence

[MIT](LICENSE)
