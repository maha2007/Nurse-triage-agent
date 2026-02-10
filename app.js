(function () {
  'use strict';

  let state = {
    patient: null,
    allergies: [],
    conditions: [],
    medications: [],
    observations: [],
    procedures: [],
    immunizations: [],
    encounter: null,
    documents: [],
    familyHistory: [],
    carePlans: [],
    goals: [],
    bundle: null
  };

  let expandedCardId = null;

  function formatDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatDateShort(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function ageFromBirthDate(birthDate) {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function getDisplay(o) {
    if (!o) return '';
    if (typeof o === 'string') return o;
    if (o.display) return o.display;
    if (o.text) return o.text;
    if (Array.isArray(o.coding) && o.coding[0]) return o.coding[0].display || o.coding[0].code || '';
    return JSON.stringify(o);
  }

  function maskSSN(val) {
    if (!val || typeof val !== 'string') return '—';
    return val.replace(/\d(?=\d{4})/g, '*');
  }

  /** Render object as key-value list for expanded section (all fields). Returns a UL element. */
  function renderDetailList(obj, prefix) {
    if (!obj || typeof obj !== 'object') return document.createElement('ul');
    prefix = prefix || '';
    const ul = document.createElement('ul');
    ul.className = 'detail-list';
    const skip = ['_summaryRendered'];
    for (const key of Object.keys(obj)) {
      if (skip.includes(key)) continue;
      const v = obj[key];
      if (v === undefined || v === null) continue;
      const label = prefix + key;
      if (Array.isArray(v)) {
        const li = document.createElement('li');
        li.innerHTML = '<strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(JSON.stringify(v, null, 2));
        ul.appendChild(li);
      } else if (typeof v === 'object' && v !== null && !v.coding && !v.valueQuantity && !v.repeat && v.constructor === Object) {
        const inner = renderDetailList(v, label + '.');
        if (inner && inner.children.length) {
          const wrap = document.createElement('li');
          wrap.innerHTML = '<strong>' + escapeHtml(label) + '</strong>';
          wrap.appendChild(inner);
          ul.appendChild(wrap);
        }
      } else {
        const li = document.createElement('li');
        let text = v;
        if (typeof v === 'object') text = getDisplay(v) || JSON.stringify(v);
        if (key.toLowerCase().includes('ssn') || (key === 'value' && String(obj.system || '').includes('ssn'))) text = maskSSN(String(text));
        li.innerHTML = '<strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(String(text));
        ul.appendChild(li);
      }
    }
    return ul;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function parseBundle(bundle) {
    state.bundle = bundle;
    state.patient = null;
    state.allergies = [];
    state.conditions = [];
    state.medications = [];
    state.observations = [];
    state.procedures = [];
    state.immunizations = [];
    state.encounter = null;
    state.documents = [];
    state.familyHistory = [];
    state.carePlans = [];
    state.goals = [];

    const entries = bundle.entry || [];
    for (const e of entries) {
      const r = e.resource;
      if (!r) continue;
      switch (r.resourceType) {
        case 'Patient': state.patient = r; break;
        case 'AllergyIntolerance': state.allergies.push(r); break;
        case 'Condition': state.conditions.push(r); break;
        case 'MedicationStatement': state.medications.push(r); break;
        case 'Observation': state.observations.push(r); break;
        case 'Procedure': state.procedures.push(r); break;
        case 'Immunization': state.immunizations.push(r); break;
        case 'Encounter': state.encounter = r; break;
        case 'DocumentReference': state.documents.push(r); break;
        case 'FamilyMemberHistory': state.familyHistory.push(r); break;
        case 'CarePlan': state.carePlans.push(r); break;
        case 'Goal': state.goals.push(r); break;
        default: break;
      }
    }
  }

  function renderCard(cardId, title, badges, summaryHtml, expandHtml) {
    const el = document.getElementById(cardId);
    if (!el) return;
    const isExpanded = expandedCardId === cardId;
    el.className = 'card' + (isExpanded ? ' expanded' : '');
    el.innerHTML =
      '<div class="card-header" data-card="' + escapeHtml(cardId) + '">' +
        '<span class="card-title">' + escapeHtml(title) + '</span>' +
        (badges ? '<span>' + badges + '</span>' : '') +
        '<button type="button" class="card-toggle" aria-label="Toggle details"><span class="expand-icon">▼</span> View details</button>' +
      '</div>' +
      '<div class="card-body">' + summaryHtml + '</div>' +
      (expandHtml ? '<div class="card-expand" style="display:' + (isExpanded ? 'block' : 'none') + '">' + expandHtml + '</div>' : '');
    const header = el.querySelector('.card-header');
    const expandDiv = el.querySelector('.card-expand');
    if (header && expandDiv) {
      header.addEventListener('click', function () {
        if (expandedCardId === cardId) {
          expandedCardId = null;
          expandDiv.style.display = 'none';
          el.classList.remove('expanded');
        } else {
          if (expandedCardId) {
            const prev = document.getElementById(expandedCardId);
            if (prev) {
              const prevExpand = prev.querySelector('.card-expand');
              if (prevExpand) prevExpand.style.display = 'none';
              prev.classList.remove('expanded');
            }
          }
          expandedCardId = cardId;
          expandDiv.style.display = 'block';
          el.classList.add('expanded');
        }
      });
    }
  }

  function pill(cls, text) {
    return '<span class="pill ' + cls + '">' + escapeHtml(text) + '</span>';
  }

  function renderHeader() {
    const p = state.patient;
    if (!p) return;
    const name = p.name && p.name[0];
    const family = name ? (name.family || '') : '';
    const given = name && name.given ? name.given.join(' ') : '';
    const fullName = family + (given ? ', ' + given : '');
    const mrn = (p.identifier || []).find(i => i.type && i.type.coding && i.type.coding[0] && i.type.coding[0].code === 'MR');
    const mrnVal = mrn ? mrn.value : '—';
    const addr = p.address && p.address[0];
    const cityState = addr ? (addr.city || '') + (addr.state ? ', ' + addr.state : '') + (addr.postalCode ? ' ' + addr.postalCode : '') : '';
    const age = ageFromBirthDate(p.birthDate);
    document.getElementById('patient-name').textContent = fullName || '—';
    document.getElementById('patient-meta').textContent = [
      p.gender || '',
      'DOB: ' + formatDate(p.birthDate),
      age != null ? age + ' yrs' : '',
      'MRN: ' + mrnVal,
      cityState
    ].filter(Boolean).join(' · ') || '—';

    const enc = state.encounter;
    const encDate = enc && enc.period && enc.period.start ? formatDate(enc.period.start) : '—';
    const encDr = enc && enc.participant && enc.participant[0] && enc.participant[0].individual ? enc.participant[0].individual.display : '—';
    document.getElementById('last-encounter').textContent = 'Last Encounter: ' + encDate + ' · ' + encDr;
    document.getElementById('last-encounter').setAttribute('data-card', 'card-encounter');
  }

  function renderPatientCard() {
    const p = state.patient;
    if (!p) return;
    const phone = (p.telecom || []).find(t => t.system === 'phone' && t.use === 'home');
    const mobile = (p.telecom || []).find(t => t.system === 'phone' && (t.use === 'mobile' || !t.use));
    const email = (p.telecom || []).find(t => t.system === 'email');
    const marital = p.maritalStatus && p.maritalStatus.coding && p.maritalStatus.coding[0] ? p.maritalStatus.coding[0].display : '';
    const lang = p.communication && p.communication[0] && p.communication[0].language && p.communication[0].language.coding && p.communication[0].language.coding[0]
      ? p.communication[0].language.coding[0].display : '';
    const badges = p.active ? pill('pill-active', 'ACTIVE') : '';
    const summary =
      '<dl><dt>Phone</dt><dd>' + escapeHtml((phone && phone.value) || '—') + '</dd>' +
      '<dt>Mobile</dt><dd>' + escapeHtml((mobile && mobile.value) || '—') + '</dd>' +
      '<dt>Email</dt><dd><a href="mailto:' + escapeHtml((email && email.value) || '') + '">' + escapeHtml((email && email.value) || '—') + '</a></dd>' +
      '<dt>Status</dt><dd>' + escapeHtml(marital) + '</dd>' +
      '<dt>Language</dt><dd>' + escapeHtml(lang) + '</dd></dl>';
    const expandDiv = document.createElement('div');
    expandDiv.appendChild(renderDetailList(p));
    renderCard('card-patient', 'PATIENT', badges, summary, expandDiv.innerHTML);
  }

  function renderEmergencyContactCard() {
    const p = state.patient;
    if (!p || !p.contact || !p.contact[0]) return;
    const c = p.contact[0];
    const rel = c.relationship && c.relationship[0] && c.relationship[0].coding && c.relationship[0].coding[0] ? c.relationship[0].coding[0].display : '';
    const name = c.name ? (c.name.given ? c.name.given.join(' ') + ' ' : '') + (c.name.family || '') : '—';
    const phone = c.telecom && c.telecom[0] ? c.telecom[0].value : '—';
    const summary =
      '<dl><dt>Name</dt><dd>' + escapeHtml(name) + '</dd>' +
      '<dt>Relation</dt><dd>' + escapeHtml(rel) + '</dd>' +
      '<dt>Phone</dt><dd>' + escapeHtml(phone) + '</dd></dl>';
    const expandDiv = document.createElement('div');
    expandDiv.appendChild(renderDetailList(c));
    renderCard('card-emergency-contact', 'EMERGENCY CONTACT', null, summary, expandDiv.innerHTML);
  }

  function renderAllergiesCard() {
    const list = state.allergies;
    const count = list.length;
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach((a, i) => {
      const name = (a.code && a.code.text) || getDisplay(a.code) || '—';
      const crit = (a.criticality || '').toLowerCase();
      const cat = Array.isArray(a.category) ? a.category[0] : '';
      const reactionText = a.reaction && a.reaction[0]
        ? (a.reaction[0].manifestation && a.reaction[0].manifestation[0] ? getDisplay(a.reaction[0].manifestation[0]) : '') + (a.reaction[0].severity ? ' · ' + a.reaction[0].severity : '')
        : '';
      const critClass = crit === 'high' ? 'pill-high' : 'pill-low';
      const catDisplay = cat === 'medication' ? 'MEDICATION' : cat === 'food' ? 'FOOD' : (cat || '').toUpperCase();
      const catPillClass = cat === 'food' ? 'pill-food' : 'pill-medication';
      summary += '<li><strong>' + escapeHtml(name) + '</strong> ' + escapeHtml(reactionText) +
        ' <span class="item-tags">' + pill(critClass, crit.toUpperCase()) + (catDisplay ? ' ' + pill(catPillClass, catDisplay) : '') + '</span></li>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(a));
      expandParts.push('<h4>' + escapeHtml(name) + '</h4>' + expDiv.innerHTML);
    });
    summary += '</ul>';
    const badges = count ? pill('pill-count', String(count)) : '';
    renderCard('card-allergies', 'ALLERGIES', badges, summary, expandParts.join('<hr/>'));
  }

  function renderConditionsCard() {
    const list = state.conditions;
    const active = list.filter(c => c.clinicalStatus && c.clinicalStatus.coding && c.clinicalStatus.coding[0] && c.clinicalStatus.coding[0].code === 'active');
    const resolved = list.filter(c => c.clinicalStatus && c.clinicalStatus.coding && c.clinicalStatus.coding[0] && c.clinicalStatus.coding[0].code === 'resolved');
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach(c => {
      const name = (c.code && c.code.text) || getDisplay(c.code) || '—';
      const icd = (c.code && c.code.coding) ? c.code.coding.find(x => x.system && x.system.indexOf('icd-10') !== -1) : null;
      const icdCode = icd ? icd.code : '';
      const sev = c.severity && c.severity.coding && c.severity.coding[0] ? c.severity.coding[0].display : '';
      const status = c.clinicalStatus && c.clinicalStatus.coding && c.clinicalStatus.coding[0] ? c.clinicalStatus.coding[0].code : '';
      const onset = c.onsetDateTime ? formatDateShort(c.onsetDateTime) : '';
      const abatement = c.abatementDateTime ? formatDateShort(c.abatementDateTime) : '';
      const bodySite = c.bodySite && c.bodySite[0] ? getDisplay(c.bodySite[0]) : '';
      let sub = onset ? 'Since ' + onset : '';
      if (abatement) sub = (onset || '') + ' → ' + abatement + (bodySite ? ' · ' + bodySite : '');
      const dotClass = status === 'resolved' ? 'dot-green' : (sev === 'Severe' ? 'dot-red' : 'dot-amber');
      const statusPill = status === 'active' ? pill('pill-active', 'ACTIVE') : pill('pill-resolved', 'RESOLVED');
      const sevPill = sev ? pill(sev === 'Severe' ? 'pill-severe' : 'pill-suboptimal', sev.toUpperCase().replace(' ', '')) : '';
      summary += '<li class="' + dotClass + '"><strong>' + escapeHtml(name) + '</strong> ' + escapeHtml(sub) +
        ' <span class="item-tags">' + sevPill + ' ' + statusPill + (icdCode ? ' ' + pill('pill-icd', 'ICD-10: ' + icdCode) : '') + '</span></li>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(c));
      expandParts.push(expDiv.innerHTML);
    });
    summary += '</ul>';
    const badges = pill('pill-high', active.length + ' ACTIVE') + ' ' + pill('pill-count', resolved.length + ' RESOLVED');
    renderCard('card-conditions', 'CONDITIONS', badges, summary, expandParts.join('<hr/>'));
  }

  function renderMedicationsCard() {
    const list = state.medications.filter(m => m.status === 'active');
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach(m => {
      const name = (m.medicationCodeableConcept && m.medicationCodeableConcept.text) || getDisplay(m.medicationCodeableConcept) || '—';
      const dosageText = m.dosage && m.dosage[0] && m.dosage[0].text ? m.dosage[0].text : '';
      const effective = m.effectiveDateTime ? formatDateShort(m.effectiveDateTime) : '';
      const ace = name.toLowerCase().indexOf('lisinopril') !== -1 ? pill('pill-ace', 'ACE-I') : '';
      summary += '<li><strong>' + escapeHtml(name) + '</strong> ' + escapeHtml(dosageText) + ' ' + escapeHtml(effective ? 'Since ' + effective : '') + ' ' + ace + '</li>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(m));
      expandParts.push(expDiv.innerHTML);
    });
    summary += '</ul>';
    const badges = pill('pill-count', list.length + ' ACTIVE');
    renderCard('card-medications', 'CURRENT MEDICATIONS', badges, summary, expandParts.join('<hr/>'));
  }

  function getObsByCategory(cat) {
    return state.observations.filter(o => o.category && o.category.some(c => c.coding && c.coding.some(x => x.code === cat)));
  }

  function renderVitalsCard() {
    const vitals = getObsByCategory('vital-signs');
    const bp = vitals.find(o => o.code && o.code.coding && o.code.coding.some(x => x.code === '85354-9'));
    const weight = vitals.find(o => o.code && o.code.coding && o.code.coding.some(x => x.code === '29463-7'));
    const weightGoal = state.goals.find(g => g.target && g.target[0] && g.target[0].measure && g.target[0].measure.coding && g.target[0].measure.coding.some(m => m.code === '29463-7'));
    const goalVal = weightGoal && weightGoal.target && weightGoal.target[0] && weightGoal.target[0].detailQuantity ? weightGoal.target[0].detailQuantity.value + ' ' + (weightGoal.target[0].detailQuantity.unit || 'lbs') : null;
    const date = vitals[0] && vitals[0].effectiveDateTime ? formatDate(vitals[0].effectiveDateTime) : '—';
    let summary = '<p class="vital-label">' + escapeHtml(date) + '</p>';
    if (bp && bp.component) {
      const sys = bp.component.find(c => c.code && c.code.coding && c.code.coding.some(x => x.code === '8480-6'));
      const dia = bp.component.find(c => c.code && c.code.coding && c.code.coding.some(x => x.code === '8462-4'));
      const sVal = sys && sys.valueQuantity ? sys.valueQuantity.value : '—';
      const dVal = dia && dia.valueQuantity ? dia.valueQuantity.value : '—';
      summary += '<div class="vital-box"><div class="vital-label">BLOOD PRESSURE</div><div class="vital-value normal">' + sVal + '/' + dVal + ' mmHg</div><div class="vital-label">Systolic / Diastolic</div></div>';
    }
    if (weight && weight.valueQuantity) {
      const wVal = weight.valueQuantity.value + ' ' + (weight.valueQuantity.unit || 'lbs');
      summary += '<div class="vital-box"><div class="vital-label">WEIGHT</div><div class="vital-value warning">' + escapeHtml(wVal) + '</div>' + (goalVal ? '<div class="vital-label">Goal: ' + escapeHtml(goalVal) + '</div>' : '') + '</div>';
    }
    let expandParts = [];
    vitals.forEach(o => {
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(o));
      expandParts.push(expDiv.innerHTML);
    });
    renderCard('card-vitals', 'RECENT VITALS', null, summary, expandParts.join('<hr/>'));
  }

  function renderLabsCard() {
    const labs = getObsByCategory('laboratory');
    const date = labs[0] && labs[0].effectiveDateTime ? formatDate(labs[0].effectiveDateTime) : '—';
    let summary = '<p class="vital-label">' + escapeHtml(date) + '</p>';
    let expandParts = [];
    labs.forEach(o => {
      const name = (o.code && o.code.text) || getDisplay(o.code) || '—';
      const vq = o.valueQuantity;
      const val = vq ? vq.value + (vq.unit || '') : '—';
      const interp = o.interpretation && o.interpretation[0] && o.interpretation[0].coding && o.interpretation[0].coding[0] ? o.interpretation[0].coding[0].code : '';
      const refText = o.referenceRange && o.referenceRange[0] ? (o.referenceRange[0].text || (o.referenceRange[0].low ? (o.referenceRange[0].low.value + (o.referenceRange[0].low.unit || '')) + '–' : '') + (o.referenceRange[0].high ? (o.referenceRange[0].high.value + (o.referenceRange[0].high.unit || '')) : '')) : '';
      const interpClass = interp === 'H' ? 'pill-high' : interp === 'N' ? 'pill-normal' : 'pill-low';
      const interpDisplay = interp === 'H' ? 'HIGH' : interp === 'N' ? 'NORMAL' : interp || '';
      summary += '<div class="lab-row"><span class="lab-name">' + escapeHtml(name) + '</span> <span class="lab-value">' + escapeHtml(val) + '</span> ' + (interpDisplay ? pill(interpClass, interpDisplay) : '') + ' <span class="lab-ref">' + escapeHtml(refText) + '</span></div>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(o));
      expandParts.push(expDiv.innerHTML);
    });
    renderCard('card-labs', 'LAB RESULTS', null, summary, expandParts.join('<hr/>'));
  }

  function renderActiveCard() {
    const plan = state.carePlans[0];
    const goals = state.goals;
    const planTitle = plan && plan.title ? plan.title : '—';
    let summary = '<p>' + pill('pill-ace', planTitle) + '</p>';
    const a1cGoal = goals.find(g => g.description && g.description.text && g.description.text.toLowerCase().indexOf('a1c') !== -1);
    const weightGoal = goals.find(g => g.description && g.description.text && g.description.text.toLowerCase().indexOf('pound') !== -1);
    const a1cObs = state.observations.find(o => o.code && o.code.coding && o.code.coding.some(x => x.code === '4548-4'));
    const currentA1c = a1cObs && a1cObs.valueQuantity ? a1cObs.valueQuantity.value + '%' : '—';
    a1cGoal && (summary += '<div class="goal-row"><span class="goal-desc">' + escapeHtml(a1cGoal.description.text) + '</span> ' + pill('pill-in-progress', 'IN PROGRESS') + '<div class="goal-meta">Current ' + escapeHtml(currentA1c) + ' · Target &lt;7.0% · Due ' + (a1cGoal.target && a1cGoal.target[0] && a1cGoal.target[0].dueDate ? formatDate(a1cGoal.target[0].dueDate) : '—') + '</div><div class="progress-bar"><div class="progress-fill pill-low" style="width:70%"></div></div></div>');
    weightGoal && (summary += '<div class="goal-row"><span class="goal-desc">' + escapeHtml(weightGoal.description.text) + ' → target 180 lbs</span> ' + pill('pill-in-progress', 'IN PROGRESS') + '<div class="progress-bar"><div class="progress-fill pill-low" style="width:50%"></div></div></div>');
    let expandParts = [];
    if (plan) {
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(plan));
      expandParts.push('<h4>Care Plan</h4>' + expDiv.innerHTML);
    }
    goals.forEach(g => {
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(g));
      expandParts.push(expDiv.innerHTML);
    });
    renderCard('card-active', 'ACTIVE', null, summary, expandParts.join('<hr/>'));
  }

  function renderProceduresCard() {
    const list = state.procedures;
    if (!list.length) return;
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach(proc => {
      const name = (proc.code && proc.code.text) || getDisplay(proc.code) || '—';
      const date = proc.performedDateTime ? formatDate(proc.performedDateTime) : '—';
      const performer = proc.performer && proc.performer[0] && proc.performer[0].actor ? proc.performer[0].actor.display : '—';
      const outcome = proc.outcome && proc.outcome.coding && proc.outcome.coding[0] ? proc.outcome.coding[0].display : '—';
      summary += '<li><strong>' + escapeHtml(name) + '</strong> ' + escapeHtml(date) + ' · ' + escapeHtml(performer) + ' · ' + escapeHtml(outcome) + '</li>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(proc));
      expandParts.push(expDiv.innerHTML);
    });
    summary += '</ul>';
    renderCard('card-procedures', 'PROCEDURES', null, summary, expandParts.join('<hr/>'));
  }

  function renderImmunizationsCard() {
    const list = state.immunizations;
    if (!list.length) return;
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach(imm => {
      const name = (imm.vaccineCode && imm.vaccineCode.text) || getDisplay(imm.vaccineCode) || '—';
      const date = imm.occurrenceDateTime ? formatDate(imm.occurrenceDateTime) : '—';
      const lot = imm.lotNumber || '—';
      const exp = imm.expirationDate ? formatDate(imm.expirationDate) : '—';
      summary += '<li><strong>' + escapeHtml(name) + '</strong> ' + escapeHtml(date) + ' · Lot ' + escapeHtml(lot) + ' · Exp ' + escapeHtml(exp) + '</li>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(imm));
      expandParts.push(expDiv.innerHTML);
    });
    summary += '</ul>';
    renderCard('card-immunizations', 'IMMUNIZATIONS', null, summary, expandParts.join('<hr/>'));
  }

  function renderFamilyHistoryCard() {
    const list = state.familyHistory;
    if (!list.length) return;
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach(f => {
      const rel = f.relationship && f.relationship.coding && f.relationship.coding[0] ? f.relationship.coding[0].display : '—';
      let conds = (f.condition || []).map(c => (c.code && c.code.text) || getDisplay(c.code) + (c.onsetAge ? ' at ' + c.onsetAge.value + ' ' + (c.onsetAge.unit || 'y') : '')).join('; ');
      summary += '<li><strong>' + escapeHtml(rel) + '</strong> ' + escapeHtml(conds) + '</li>';
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(f));
      expandParts.push(expDiv.innerHTML);
    });
    summary += '</ul>';
    renderCard('card-family-history', 'FAMILY HISTORY', null, summary, expandParts.join('<hr/>'));
  }

  function renderDocumentsCard() {
    const list = state.documents;
    if (!list.length) return;
    let summary = '<ul class="card-list">';
    let expandParts = [];
    list.forEach(doc => {
      const desc = doc.description || '—';
      const date = doc.date ? formatDate(doc.date) : '—';
      const author = doc.author && doc.author[0] ? doc.author[0].display : '—';
      const title = doc.content && doc.content[0] && doc.content[0].attachment ? doc.content[0].attachment.title : '—';
      summary += '<li><strong>' + escapeHtml(desc) + '</strong> ' + escapeHtml(date) + ' · ' + escapeHtml(author) + ' · ' + escapeHtml(title) + '</li>';
      const clone = JSON.parse(JSON.stringify(doc));
      if (clone.content && clone.content[0] && clone.content[0].attachment && clone.content[0].attachment.data) {
        try {
          clone.content[0].attachment.decodedText = atob(clone.content[0].attachment.data);
        } catch (e) {
          clone.content[0].attachment.decodedError = String(e);
        }
      }
      const expDiv = document.createElement('div');
      expDiv.appendChild(renderDetailList(clone));
      if (doc.content && doc.content[0] && doc.content[0].attachment && doc.content[0].attachment.data) {
        try {
          const pre = document.createElement('pre');
          pre.textContent = atob(doc.content[0].attachment.data);
          expDiv.appendChild(pre);
        } catch (e) {}
      }
      expandParts.push(expDiv.innerHTML);
    });
    summary += '</ul>';
    renderCard('card-documents', 'DOCUMENTS', null, summary, expandParts.join('<hr/>'));
  }

  function renderEncounterInHeader() {
    const enc = state.encounter;
    if (!enc) return;
    const el = document.getElementById('last-encounter');
    if (!el) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      const cardEl = document.getElementById('card-encounter');
      if (cardEl && cardEl.querySelector('.card-header')) {
        cardEl.querySelector('.card-header').click();
        cardEl.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  function renderEncounterCard() {
    const enc = state.encounter;
    if (!enc) return;
    const summary = '<dl><dt>Period</dt><dd>' + (enc.period && enc.period.start ? formatDate(enc.period.start) + ' – ' + (enc.period.end ? formatDate(enc.period.end) : '') : '—') + '</dd>' +
      '<dt>Participant</dt><dd>' + (enc.participant && enc.participant[0] && enc.participant[0].individual ? enc.participant[0].individual.display : '—') + '</dd>' +
      '<dt>Type</dt><dd>' + (enc.type && enc.type[0] && enc.type[0].text ? enc.type[0].text : getDisplay(enc.type && enc.type[0])) + '</dd>' +
      '<dt>Reason</dt><dd>' + (enc.reasonCode && enc.reasonCode[0] && enc.reasonCode[0].text ? enc.reasonCode[0].text : getDisplay(enc.reasonCode && enc.reasonCode[0])) + '</dd>' +
      '<dt>Location</dt><dd>' + (enc.location && enc.location[0] && enc.location[0].location ? enc.location[0].location.display : '—') + '</dd></dl>';
    const expDiv = document.createElement('div');
    expDiv.appendChild(renderDetailList(enc));
    const cardEl = document.getElementById('card-encounter');
    if (cardEl) renderCard('card-encounter', 'LAST ENCOUNTER (expand for all fields)', null, summary, expDiv.innerHTML);
  }

  function renderBundleFooter() {
    const b = state.bundle;
    if (!b) return;
    const footer = document.getElementById('bundle-footer');
    if (!footer) return;
    footer.innerHTML = 'Bundle: ' + escapeHtml(b.id || '') + ' · type: ' + escapeHtml(b.type || '') + ' · timestamp: ' + escapeHtml(b.timestamp || '');
  }

  function expandAllCards() {
    expandedCardId = null;
    document.querySelectorAll('.card').forEach(function (card) {
      const expandDiv = card.querySelector('.card-expand');
      if (expandDiv) {
        expandDiv.style.display = 'block';
        card.classList.add('expanded');
      }
    });
  }

  function init() {
    var btnExpand = document.getElementById('btn-expand-all');
    if (btnExpand) btnExpand.addEventListener('click', expandAllCards);

    var btnPredictions = document.getElementById('btn-predictions');
    var predictionsStatus = document.getElementById('predictions-status');
    if (btnPredictions && predictionsStatus) {
      btnPredictions.addEventListener('click', function (e) {
        e.preventDefault();
        if (btnPredictions.getAttribute('aria-busy') === 'true') return;
        var existing = sessionStorage.getItem('predictionsResult');
        if (existing) {
          window.location.href = 'predictions.html';
          return;
        }
        btnPredictions.setAttribute('aria-busy', 'true');
        btnPredictions.style.pointerEvents = 'none';
        predictionsStatus.style.display = 'inline';
        predictionsStatus.textContent = 'Running diagnostic analysis…';
        predictionsStatus.style.color = '';
        fetch(window.location.origin + '/api/predictions')
          .then(function (res) {
            if (!res.ok) return res.json().then(function (err) { throw new Error(err.error || res.statusText); });
            return res.json();
          })
          .then(function (data) {
            try { sessionStorage.setItem('predictionsResult', JSON.stringify(data)); } catch (err) {}
            window.location.href = 'predictions.html';
          })
          .catch(function (err) {
            predictionsStatus.textContent = 'Error: ' + (err.message || 'Analysis failed.');
            predictionsStatus.style.color = 'var(--red)';
            btnPredictions.setAttribute('aria-busy', 'false');
            btnPredictions.style.pointerEvents = '';
          });
      });
    }

    fetch(window.location.origin + '/api/predictions')
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) {
        try { sessionStorage.setItem('predictionsResult', JSON.stringify(data)); } catch (e) {}
      })
      .catch(function () {});

    fetch('medical_history.json')
      .then(function (res) { return res.json(); })
      .then(function (bundle) {
        parseBundle(bundle);
        renderHeader();
        renderPatientCard();
        renderEmergencyContactCard();
        renderAllergiesCard();
        renderConditionsCard();
        renderMedicationsCard();
        renderVitalsCard();
        renderLabsCard();
        renderActiveCard();
        renderProceduresCard();
        renderImmunizationsCard();
        renderFamilyHistoryCard();
        renderDocumentsCard();
        renderEncounterCard();
        renderEncounterInHeader();
        renderBundleFooter();
      })
      .catch(function (err) {
        document.getElementById('patient-name').textContent = 'Error loading data';
        document.getElementById('patient-meta').textContent = err.message || 'Failed to load medical_history.json';
      });
  }

  init();
})();
