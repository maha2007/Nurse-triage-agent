require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

const TriageSchema = z.object({ specialties: z.array(z.string()).length(3) });
const SpecialistSchema = z.object({
  recommendedTests: z.array(z.string()),
  differentialDiagnoses: z.array(z.string())
});
const RecommendedTestSchema = z.object({
  test: z.string(),
  score: z.number(),
  weight: z.number(),
  recommendedBy: z.array(z.string())
});
const DifferentialSchema = z.object({
  diagnosis: z.string(),
  score: z.number(),
  weight: z.number(),
  confidence: z.enum(['High', 'Moderate', 'Low']),
  recommendedBy: z.array(z.string())
});
const ConsensusSchema = z.object({
  recommendedTests: z.array(RecommendedTestSchema),
  differentialDiagnoses: z.array(DifferentialSchema)
});

let cachedPredictions = null;

function buildPatientSummary(bundle) {
  const entries = bundle.entry || [];
  const patient = entries.find(e => e.resource && e.resource.resourceType === 'Patient');
  const conditions = entries.filter(e => e.resource && e.resource.resourceType === 'Condition');
  const medications = entries.filter(e => e.resource && e.resource.resourceType === 'MedicationStatement');
  const observations = entries.filter(e => e.resource && e.resource.resourceType === 'Observation');
  const allergies = entries.filter(e => e.resource && e.resource.resourceType === 'AllergyIntolerance');

  let summary = '';
  if (patient && patient.resource) {
    const p = patient.resource;
    const name = p.name && p.name[0] ? [p.name[0].family, ...(p.name[0].given || [])].filter(Boolean).join(' ') : 'Unknown';
    summary += `Patient: ${name}. Gender: ${p.gender || 'unknown'}. DOB: ${p.birthDate || 'unknown'}.\n`;
  }
  if (conditions.length) {
    summary += 'Conditions: ' + conditions.map(c => (c.resource.code && c.resource.code.text) || '—').join('; ') + '.\n';
  }
  if (medications.length) {
    summary += 'Medications: ' + medications.map(m => (m.resource.medicationCodeableConcept && m.resource.medicationCodeableConcept.text) || '—').join('; ') + '.\n';
  }
  if (observations.length) {
    const vitals = observations.filter(o => o.resource.category && o.resource.category.some(c => c.coding && c.coding.some(x => x.code === 'vital-signs')));
    const labs = observations.filter(o => o.resource.category && o.resource.category.some(c => c.coding && c.coding.some(x => x.code === 'laboratory')));
    if (vitals.length) summary += 'Recent vitals: ' + vitals.map(v => (v.resource.code && v.resource.code.text) + (v.resource.valueQuantity ? ' ' + v.resource.valueQuantity.value + (v.resource.valueQuantity.unit || '') : '') + (v.resource.component ? ' ' + (v.resource.component.map(c => c.valueQuantity && c.valueQuantity.value).filter(Boolean).join('/')) : '')).join('; ') + '.\n';
    if (labs.length) summary += 'Lab results: ' + labs.map(l => (l.resource.code && l.resource.code.text) + (l.resource.valueQuantity ? ' ' + l.resource.valueQuantity.value + (l.resource.valueQuantity.unit || '') : '')).join('; ') + '.\n';
  }
  if (allergies.length) {
    summary += 'Allergies: ' + allergies.map(a => (a.resource.code && a.resource.code.text) || '—').join('; ') + '.\n';
  }
  return summary || JSON.stringify(bundle).slice(0, 3000);
}

function extractJson(text) {
  const str = String(text);
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}') + 1;
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(str.slice(start, end));
  } catch {
    return null;
  }
}

async function withRetry(fn, once = false) {
  try {
    return await fn();
  } catch (e) {
    if (once) throw e;
    return await fn();
  }
}

async function callGemini(prompt, apiKey) {
  return withRetry(async () => {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response && result.response.text ? result.response.text() : '';
    return text;
  });
}

async function callClaude(prompt, apiKey) {
  return withRetry(async () => {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });
    const block = message.content && message.content[0];
    const text = block && block.type === 'text' ? block.text : '';
    return text;
  });
}

async function agent0Triage(summary, geminiKey) {
  const prompt = `You are a triage agent. Given the following patient medical summary, output exactly 3 medical specialties that should be consulted for this patient. Return ONLY a JSON object with this exact format, no other text:
{"specialties": ["Specialty1", "Specialty2", "Specialty3"]}

Patient summary:
${summary}`;
  const text = await callGemini(prompt, geminiKey);
  const json = extractJson(text);
  return TriageSchema.parse(json);
}

async function agentSpecialist(bundle, specialty, anthropicKey) {
  const prompt = `You are a medical specialist in: ${specialty}. Given the following patient FHIR bundle (medical history), recommend diagnostic tests and differential diagnoses from your specialty perspective. Return ONLY a JSON object with this exact format, no other text:
{"recommendedTests": ["test1", "test2", ...], "differentialDiagnoses": ["diagnosis1", "diagnosis2", ...]}

Patient bundle (JSON):
${JSON.stringify(bundle).slice(0, 12000)}`;
  const text = await callClaude(prompt, anthropicKey);
  const json = extractJson(text);
  return SpecialistSchema.parse(json);
}

async function agent4Consensus(specialistOutputs, geminiKey) {
  const prompt = `You are a consensus agent. Three specialists have given their recommended tests and differential diagnoses. Normalize medical terms (e.g. "High Blood Pressure" -> "Hypertension"). For each unique test and each unique diagnosis, count how many of the 3 specialists recommended it (N). Compute Score = Math.round((N/3)*100), Weight = N. For diagnoses, set confidence: High if N=3, Moderate if N=2, Low if N=1. Return ONLY a JSON object with this exact format, no other text:
{"recommendedTests": [{"test": "normalized name", "score": 0-100, "weight": 1-3, "recommendedBy": ["Specialty1", ...]}], "differentialDiagnoses": [{"diagnosis": "normalized name", "score": 0-100, "weight": 1-3, "confidence": "High"|"Moderate"|"Low", "recommendedBy": ["Specialty1", ...]}]}
Sort each array by score descending.

Specialist outputs (specialty -> recommendedTests, differentialDiagnoses):
${JSON.stringify(specialistOutputs)}`;
  const text = await callGemini(prompt, geminiKey);
  const json = extractJson(text);
  return ConsensusSchema.parse(json);
}

async function runDiagnosticAnalysis(bundle) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!geminiKey || !anthropicKey) {
    throw new Error('Missing GEMINI_API_KEY or ANTHROPIC_API_KEY in environment.');
  }
  const summary = buildPatientSummary(bundle);
  const triage = await agent0Triage(summary, geminiKey);
  const specialties = triage.specialties;
  const [out1, out2, out3] = await Promise.all([
    agentSpecialist(bundle, specialties[0], anthropicKey),
    agentSpecialist(bundle, specialties[1], anthropicKey),
    agentSpecialist(bundle, specialties[2], anthropicKey)
  ]);
  const specialistOutputs = [
    { specialty: specialties[0], ...out1 },
    { specialty: specialties[1], ...out2 },
    { specialty: specialties[2], ...out3 }
  ];
  const consensus = await agent4Consensus(specialistOutputs, geminiKey);
  return {
    recommendedTests: (consensus.recommendedTests || []).slice(0, 9),
    differentialDiagnoses: (consensus.differentialDiagnoses || []).slice(0, 9)
  };
}

app.get('/api/predictions', async (req, res) => {
  try {
    if (cachedPredictions) {
      return res.json(cachedPredictions);
    }
    const filePath = path.join(__dirname, 'medical_history.json');
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'medical_history.json not found.' });
    }
    const bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = await runDiagnosticAnalysis(bundle);
    cachedPredictions = result;
    res.json(result);
  } catch (err) {
    console.error('GET /api/predictions error:', err);
    res.status(500).json({ error: err.message || 'Predictions failed.' });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    let bundle = req.body && req.body.entry ? req.body : null;
    if (!bundle || !bundle.entry) {
      const filePath = path.join(__dirname, 'medical_history.json');
      if (fs.existsSync(filePath)) {
        bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } else {
        return res.status(400).json({ error: 'No bundle in request body and medical_history.json not found.' });
      }
    }
    const result = await runDiagnosticAnalysis(bundle);
    cachedPredictions = result;
    res.json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    const message = err.message || 'Analysis failed';
    res.status(500).json({ error: message });
  }
});

const TranscriptionAnalysisSchema = z.object({
  recommendedTests: z.array(RecommendedTestSchema),
  differentialDiagnoses: z.array(DifferentialSchema),
  followUpQuestions: z.array(z.string()).optional()
});

app.post('/api/analyze-transcription', async (req, res) => {
  try {
    const { transcription = '', currentRecommendedTests = [], currentDifferentialDiagnoses = [] } = req.body || {};
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY in environment.' });
    }
    const prompt = `You are a medical analyst. Below is a live transcript of a nurse-patient interview and the current recommended tests and differential diagnoses scoreboards.

Your task:
1) Decide if any NEW information in the conversation should change these scoreboards. If the patient reports symptoms, history, or details that support adding a test or diagnosis, add it with an appropriate score (0-100) and weight (1-3). If something is ruled out or contradicted by the conversation, remove it. If relevance/confidence changes, update scores. If nothing in the transcript is relevant to change the lists, return the current lists unchanged.
2) Based on the conversation so far, suggest 3 to 5 short follow-up questions the nurse could ask next (e.g. to clarify symptoms, medication adherence, or relevant history). Only include questions that are relevant given what was already discussed.

Return ONLY a JSON object with this exact format, no other text:
{"recommendedTests": [{"test": "string", "score": number, "weight": number, "recommendedBy": ["string"]}], "differentialDiagnoses": [{"diagnosis": "string", "score": number, "weight": number, "confidence": "High"|"Moderate"|"Low", "recommendedBy": ["string"]}], "followUpQuestions": ["question 1?", "question 2?", ...]}
Sort recommendedTests and differentialDiagnoses by score descending. Keep at most 9 items per list. followUpQuestions: array of 3-5 strings.

--- Conversation transcript ---
${(transcription || '').slice(0, 15000)}

--- Current recommended tests ---
${JSON.stringify(currentRecommendedTests)}

--- Current differential diagnoses ---
${JSON.stringify(currentDifferentialDiagnoses)}
`;
    const text = await callClaude(prompt, anthropicKey);
    const json = extractJson(text);
    if (!json || !Array.isArray(json.recommendedTests)) json.recommendedTests = currentRecommendedTests;
    if (!json || !Array.isArray(json.differentialDiagnoses)) json.differentialDiagnoses = currentDifferentialDiagnoses;
    const parsed = TranscriptionAnalysisSchema.parse({
      recommendedTests: (json.recommendedTests || []).slice(0, 9),
      differentialDiagnoses: (json.differentialDiagnoses || []).slice(0, 9),
      followUpQuestions: Array.isArray(json.followUpQuestions) ? json.followUpQuestions.slice(0, 8) : []
    });
    res.json(parsed);
  } catch (err) {
    console.error('Analyze-transcription error:', err);
    res.status(500).json({ error: err.message || 'Transcription analysis failed.' });
  }
});

// AssemblyAI streaming: temporary token for browser (do not expose API key to client)
app.get('/api/streaming-token', async (req, res) => {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing ASSEMBLYAI_API_KEY in environment.' });
  }
  try {
    const url = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=300`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: apiKey }
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText || 'AssemblyAI token request failed.' });
    }
    const body = await response.json();
    res.json({ token: body.token });
  } catch (err) {
    console.error('Streaming token error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate streaming token.' });
  }
});

app.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
  setImmediate(() => {
    const filePath = path.join(__dirname, 'medical_history.json');
    if (!fs.existsSync(filePath)) return;
    runDiagnosticAnalysis(JSON.parse(fs.readFileSync(filePath, 'utf8')))
      .then((result) => {
        cachedPredictions = result;
        console.log('Diagnostic analysis cached in memory.');
      })
      .catch((err) => console.error('Startup diagnostic analysis failed:', err.message));
  });
});
