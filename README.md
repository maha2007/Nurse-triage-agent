# Patient Medical History Dashboard

A single-page dashboard that displays FHIR-style medical history from `medical_history.json` in a dark-themed, three-column layout. Each section is expandable to show every field from the JSON. The **Current Predictions** feature runs a multi-agent medical diagnostic system (Council of Experts) and shows recommended tests and differential diagnoses scoreboards.

## How to run

### Dashboard only (static)

Because the app loads `medical_history.json` via `fetch()`, you need to serve the folder over HTTP (opening `index.html` directly will fail due to browser security).

From this directory, run one of:

- **Node:** `npx serve .` then open http://localhost:3000
- **Python 3:** `python -m http.server 8000` then open http://localhost:8000

### Dashboard + Current Predictions (multi-agent analysis)

The **Current Predictions** button in the header takes you to a page that analyzes the patient’s medical history using Gemini (triage + consensus) and Claude (three specialists). That page calls a backend API, so you must run the Node server and set API keys.

1. **Install dependencies:**  
   `npm install`

2. **Set API keys:**  
   Copy `.env.example` to `.env` and fill in:
   - `GEMINI_API_KEY` – Google Gemini API key (for Agent 0 Triage and Agent 4 Consensus)
   - `ANTHROPIC_API_KEY` – Anthropic Claude API key (for Agents 1, 2, 3 Specialists)
   - `ASSEMBLYAI_API_KEY` – AssemblyAI API key (for SOAP Interview live streaming transcription)  
   Optionally set `PORT` (default 3000).

3. **Start the server:**  
   `npm start`  
   The server serves the static files (dashboard, predictions page, `medical_history.json`) and the `/api/analyze` endpoint.

4. Open http://localhost:3000 (or your `PORT`), use the dashboard, then click **Current Predictions** to run the analysis. The predictions page will load the medical history and POST it to `/api/analyze`; results appear as two scoreboards (Recommended Tests, Differential Diagnoses).

## Features

- **Header:** Patient name, demographics, Last Encounter, **Current Predictions** (link to diagnostic analysis), Export PDF, Print, New Encounter, Expand all for print
- **Column 1:** PATIENT, EMERGENCY CONTACT, ALLERGIES (expandable)
- **Column 2:** CONDITIONS, CURRENT MEDICATIONS (expandable)
- **Column 3:** RECENT VITALS, LAB RESULTS, ACTIVE goals (expandable)
- **Additional row:** Last Encounter, PROCEDURES, IMMUNIZATIONS, FAMILY HISTORY, DOCUMENTS (expandable)
- **Predictions page:** Multi-agent diagnostic (Gemini + Claude), Recommended Tests scoreboard, Differential Diagnoses scoreboard (same dark theme and card styling)
