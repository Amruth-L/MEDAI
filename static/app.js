/* ════════════════════════════════════════
   MedAI — Application Logic (app.js) v3.0
════════════════════════════════════════ */

const API_BASE = '';   // same origin

// ── Chat state ──
let chatHistory = [];
let isChatLoading = false;

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initXrayUpload();
  initPdfUpload();
  initChatInput();
  checkApiStatus();
});

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// ════════════════════════════════════════
// API STATUS CHECK
// ════════════════════════════════════════
async function checkApiStatus() {
  const dot  = document.getElementById('apiStatusDot');
  const text = document.getElementById('apiStatusText');
  try {
    const res  = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    if (data.api_configured) {
      dot.className   = 'status-dot ok';
      const gcLabel   = data.gradcam_available ? ' · Grad-CAM ✓' : ' · Grad-CAM loading…';
      text.textContent = 'AI Online' + gcLabel;
    } else {
      dot.className   = 'status-dot err';
      text.textContent = 'API Key Missing';
    }
  } catch {
    dot.className   = 'status-dot err';
    text.textContent = 'Server Offline';
  }
}

// ════════════════════════════════════════
// X-RAY / DIAGNOSTIC VISION ANALYZER
// ════════════════════════════════════════
function initXrayUpload() {
  const zone      = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const clearBtn  = document.getElementById('clearImageBtn');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  });
  zone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleImageFile(fileInput.files[0]);
  });

  analyzeBtn?.addEventListener('click', () => {
    if (fileInput.files[0]) analyzeXray(fileInput.files[0]);
  });

  clearBtn?.addEventListener('click', clearXray);
}

function clearXray() {
  document.getElementById('fileInput').value = '';
  document.getElementById('uploadZone').classList.remove('hidden');
  document.getElementById('imagePreviewWrap').classList.add('hidden');
  document.getElementById('reportContent').classList.add('hidden');
  document.getElementById('reportPlaceholder').classList.remove('hidden');
  document.getElementById('heatmapSection').classList.add('hidden');
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('imagePreview').src       = e.target.result;
    document.getElementById('heatmapOriginal').src    = e.target.result;
    document.getElementById('imageMeta').textContent  = `${file.name}  ·  ${(file.size/1024).toFixed(1)} KB  ·  ${file.type}`;
    document.getElementById('uploadZone').classList.add('hidden');
    document.getElementById('imagePreviewWrap').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function analyzeXray(file) {
  const loading = document.getElementById('xrayLoading');
  const steps   = document.getElementById('loadingSteps');
  loading.classList.remove('hidden');
  document.getElementById('heatmapSection').classList.add('hidden');

  const msgs = [
    'Preprocessing image…',
    'Running Gemini Vision analysis…',
    'Extracting radiological findings…',
    'Computing Grad-CAM heatmap (ResNet-50)…',
    'Assembling diagnostic report…',
  ];
  steps.innerHTML = '';
  msgs.forEach((msg, i) => {
    setTimeout(() => {
      const div = document.createElement('div');
      div.className = 'loading-step';
      div.innerHTML = `<span>⏳</span><span>${msg}</span>`;
      steps.appendChild(div);
      setTimeout(() => {
        div.className = 'loading-step done';
        div.querySelector('span').textContent = '✅';
      }, 1400);
    }, i * 1000);
  });

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res  = await fetch(`${API_BASE}/api/analyze-xray`, { method: 'POST', body: formData });
    const data = await res.json();
    loading.classList.add('hidden');
    if (data.success) {
      renderXrayReport(data.report);
      if (data.report.heatmap_base64) renderHeatmap(data.report.heatmap_base64);
    } else {
      showError('reportContent', data.detail || 'Analysis failed');
    }
  } catch (err) {
    loading.classList.add('hidden');
    showError('reportContent', 'Server error: ' + err.message);
  }
}

function renderHeatmap(base64png) {
  document.getElementById('heatmapGradcam').src = `data:image/png;base64,${base64png}`;
  document.getElementById('heatmapSection').classList.remove('hidden');
  document.getElementById('heatmapSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderXrayReport(r) {
  document.getElementById('reportPlaceholder').classList.add('hidden');
  const content = document.getElementById('reportContent');
  content.classList.remove('hidden');

  const isNormal   = (r.classification || 'Affected').toLowerCase() === 'normal';
  const badgeClass = isNormal ? 'badge-normal' : 'badge-affected';
  const badgeIcon  = isNormal ? '✅' : '🔴';
  const badgeText  = isNormal ? 'NORMAL' : 'AFFECTED';
  const urgencyClass = (r.urgency || 'Routine').replace(/\s/g, '-');

  content.innerHTML = `
    <!-- Classification Badge -->
    <div class="classification-banner ${badgeClass}">
      <div class="classification-icon">${badgeIcon}</div>
      <div class="classification-info">
        <div class="classification-label">AI Classification</div>
        <div class="classification-result">${badgeText}</div>
        <div class="classification-conf">Confidence: ${r.classification_confidence || r.confidence || 'Moderate'}</div>
      </div>
      ${r.affected_region && r.affected_region !== 'None detected' ? `
      <div class="affected-region">
        <div class="affected-region-label">Affected Region</div>
        <div class="affected-region-text">${r.affected_region}</div>
      </div>` : ''}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 4px;">
      <h2 style="font-size:1.05rem;font-weight:800;">${r.image_type || 'Medical Image Analysis'}</h2>
      <span class="urgency-badge urgency-${urgencyClass}">🚨 ${r.urgency || 'Routine'}</span>
    </div>
    <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:16px;">Quality: ${r.quality || '—'}  ·  Model Confidence: ${r.confidence || '—'}</p>

    <div class="report-section info">
      <div class="report-section-title">📋 Findings</div>
      <ul class="report-list">${(r.findings||[]).map(f=>`<li>${f}</li>`).join('')}</ul>
    </div>

    ${r.abnormalities && r.abnormalities.length ? `
    <div class="report-section ${r.urgency==='Routine'?'warn':'danger'}">
      <div class="report-section-title">⚠️ Abnormalities</div>
      <ul class="report-list">${r.abnormalities.map(a=>`<li>${a}</li>`).join('')}</ul>
    </div>` : ''}

    <div class="report-section success">
      <div class="report-section-title">🧠 Impression</div>
      <p style="font-size:0.88rem;color:var(--text-secondary);">${r.impression || '—'}</p>
    </div>

    ${r.differential_diagnosis && r.differential_diagnosis.length ? `
    <div class="report-section info">
      <div class="report-section-title">🔬 Differential Diagnosis</div>
      <ul class="report-list">${r.differential_diagnosis.map(d=>`<li>${d}</li>`).join('')}</ul>
    </div>` : ''}

    <div class="report-section success">
      <div class="report-section-title">✅ Recommendations</div>
      <ul class="report-list">${(r.recommendations||[]).map(rec=>`<li>${rec}</li>`).join('')}</ul>
    </div>

    ${r.heatmap_available ? `
    <div class="heatmap-notice">
      🔥 <strong>Grad-CAM heatmap generated below</strong> — scroll down to see where the AI focused.
    </div>` : `
    <div class="heatmap-notice warn">
      ⚙️ Grad-CAM heatmap not available (PyTorch loading or not installed).
    </div>`}

    <div class="disclaimer-box">⚕ ${r.disclaimer || 'This AI analysis is for educational purposes only. Consult a licensed radiologist.'}</div>
  `;
}

// ════════════════════════════════════════
// PDF ANALYZER
// ════════════════════════════════════════
function initPdfUpload() {
  const zone      = document.getElementById('pdfUploadZone');
  const pdfInput  = document.getElementById('pdfInput');
  const analyzeBtn = document.getElementById('analyzePdfBtn');
  const clearBtn  = document.getElementById('clearPdfBtn');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
  });
  zone.addEventListener('click', () => pdfInput.click());

  pdfInput.addEventListener('change', () => {
    if (pdfInput.files[0]) handlePdfFile(pdfInput.files[0]);
  });

  analyzeBtn?.addEventListener('click', () => {
    if (pdfInput.files[0]) analyzePDF(pdfInput.files[0]);
  });

  clearBtn?.addEventListener('click', () => {
    pdfInput.value = '';
    document.getElementById('pdfUploadZone').classList.remove('hidden');
    document.getElementById('pdfPreviewWrap').classList.add('hidden');
    document.getElementById('pdfContent').classList.add('hidden');
    document.getElementById('pdfPlaceholder').classList.remove('hidden');
  });
}

function handlePdfFile(file) {
  document.getElementById('pdfFilename').textContent = file.name;
  document.getElementById('pdfMeta').textContent     = `${(file.size/1024).toFixed(1)} KB  ·  PDF Document`;
  document.getElementById('pdfUploadZone').classList.add('hidden');
  document.getElementById('pdfPreviewWrap').classList.remove('hidden');
}

async function analyzePDF(file) {
  const loading = document.getElementById('pdfLoading');
  loading.classList.remove('hidden');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res  = await fetch(`${API_BASE}/api/analyze-pdf`, { method: 'POST', body: formData });
    const data = await res.json();
    loading.classList.add('hidden');
    if (data.success) renderPDFResults(data.analysis);
    else showPdfError(data.error || data.detail || 'PDF analysis failed');
  } catch (err) {
    loading.classList.add('hidden');
    showPdfError('Server error: ' + err.message);
  }
}

function showPdfError(msg) {
  document.getElementById('pdfPlaceholder').classList.add('hidden');
  const el = document.getElementById('pdfContent');
  el.classList.remove('hidden');
  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red);">
    <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
    <p style="font-size:0.9rem;">${msg}</p>
  </div>`;
}

function renderPDFResults(a) {
  document.getElementById('pdfPlaceholder').classList.add('hidden');
  const el = document.getElementById('pdfContent');
  el.classList.remove('hidden');

  const urgencyClass = (a.urgency || 'Routine').replace(/\s/g, '-');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h2 style="font-size:1.05rem;font-weight:800;">📑 ${a.document_type || 'Medical Document'}</h2>
      <span class="urgency-badge urgency-${urgencyClass}">🚨 ${a.urgency || 'Routine'}</span>
    </div>

    ${a.patient_summary ? `
    <div class="report-section info" style="margin-bottom:14px;">
      <div class="report-section-title">Patient Summary</div>
      <p style="font-size:0.88rem;color:var(--text-secondary);">${a.patient_summary}</p>
    </div>` : ''}

    ${a.diagnoses && a.diagnoses.length ? `
    <div class="report-section danger">
      <div class="report-section-title">🔴 Diagnoses</div>
      <ul class="report-list">${a.diagnoses.map(d=>`<li>${d}</li>`).join('')}</ul>
    </div>` : ''}

    ${a.key_findings && a.key_findings.length ? `
    <div class="report-section warn">
      <div class="report-section-title">📋 Key Findings</div>
      <ul class="report-list">${a.key_findings.map(f=>`<li>${f}</li>`).join('')}</ul>
    </div>` : ''}

    ${a.medications && a.medications.length ? `
    <div class="report-section info">
      <div class="report-section-title">💊 Medications</div>
      <div class="entity-tags">${a.medications.map(m=>`<span class="entity-tag tag-medication">${m}</span>`).join('')}</div>
    </div>` : ''}

    ${a.lab_results && a.lab_results.length ? `
    <div class="report-section info">
      <div class="report-section-title">🔬 Lab Results</div>
      ${a.lab_results.map(l => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:0.85rem;">${l.test}</span>
          <span style="font-size:0.85rem;font-weight:700;color:${l.status==='Abnormal'||l.status==='Critical'?'var(--red)':'var(--green)'};">
            ${l.value} <small style="opacity:0.7;">${l.status}</small>
          </span>
        </div>`).join('')}
    </div>` : ''}

    ${a.risk_factors && a.risk_factors.length ? `
    <div class="report-section warn">
      <div class="report-section-title">⚠️ Risk Factors</div>
      <div class="entity-tags">${a.risk_factors.map(r=>`<span class="entity-tag tag-risk">${r}</span>`).join('')}</div>
    </div>` : ''}

    ${a.recommendations && a.recommendations.length ? `
    <div class="report-section success">
      <div class="report-section-title">✅ Recommendations</div>
      <ul class="report-list">${a.recommendations.map(r=>`<li>${r}</li>`).join('')}</ul>
    </div>` : ''}

    ${a.follow_up ? `
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:12px;">
      📅 <strong>Follow-up:</strong> ${a.follow_up}
    </div>` : ''}

    <div class="disclaimer-box" style="margin-top:14px;">⚕ ${a.disclaimer || 'This AI analysis is for educational purposes only. Always consult a licensed healthcare professional.'}</div>
  `;
}

// ════════════════════════════════════════
// MEDICAL CHAT
// ════════════════════════════════════════
function initChatInput() {
  const input = document.getElementById('chatInput');
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

function sendQuickMessage(msg) {
  document.getElementById('chatInput').value = msg;
  handleChatSend();
}

async function handleChatSend() {
  if (isChatLoading) return;
  const input   = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';
  appendChatMsg('user', message);
  const typingId = appendTyping();
  isChatLoading = true;
  document.getElementById('sendBtn').disabled = true;

  try {
    const res  = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory })
    });
    const data = await res.json();
    removeTyping(typingId);
    if (data.success) {
      appendChatMsg('assistant', data.response);
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'model', content: data.response });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    } else {
      appendChatMsg('assistant', '⚠️ Error: ' + (data.detail || 'Unknown error'));
    }
  } catch (err) {
    removeTyping(typingId);
    appendChatMsg('assistant', '⚠️ Could not reach the server. Make sure the backend is running.');
  }

  isChatLoading = false;
  document.getElementById('sendBtn').disabled = false;
}

function appendChatMsg(role, text) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const avatar = role === 'assistant' ? '⚕' : '👤';
  const html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble"><p>${html}</p></div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function appendTyping() {
  const box = document.getElementById('chatMessages');
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'chat-msg assistant msg-typing';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">⚕</div>
    <div class="msg-bubble">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

// ════════════════════════════════════════
// PATIENT RECORDS NLP
// ════════════════════════════════════════
function loadSampleRecord() {
  document.getElementById('recordInput').value = `Patient: Jane Smith, 67F
Chief Complaint: Shortness of breath and leg swelling for 1 week
History of Present Illness: Patient presents with progressive dyspnea on exertion and bilateral lower extremity edema. Reports orthopnea requiring 3 pillows.

Past Medical History:
- Congestive Heart Failure (CHF) — Chronic, NYHA Class II
- Type 2 Diabetes Mellitus — poorly controlled
- Essential Hypertension — on medication
- Hyperlipidemia
- Atrial Fibrillation

Medications:
- Furosemide 40mg daily
- Lisinopril 10mg daily
- Metformin 1000mg BID
- Warfarin 5mg daily (INR therapeutic)
- Atorvastatin 40mg QHS
- Metoprolol Succinate 50mg daily

Allergies: Penicillin (rash), Sulfa drugs

Vitals: BP 158/96 mmHg, HR 92 (irregular), RR 20, Temp 98.4F, O2 Sat 91% on RA, Weight 185 lbs

Physical Exam: Bibasilar crackles, +2 pitting edema bilateral LE, JVD present

Labs: BNP 1240 pg/mL (elevated), Creatinine 1.4 mg/dL, BG 248 mg/dL, HbA1c 9.2%

Assessment: CHF exacerbation likely triggered by dietary indiscretion (high sodium intake). Poorly controlled T2DM.

Plan: IV Furosemide 80mg, strict I&O, low sodium diet counseling, endocrinology consult for DM management, echo ordered.`;
}

function clearRecord() {
  document.getElementById('recordInput').value = '';
  document.getElementById('recordPlaceholder').classList.remove('hidden');
  document.getElementById('recordResultsContent').classList.add('hidden');
  document.getElementById('recordResultsContent').innerHTML = '';
}

async function analyzeRecord() {
  const text = document.getElementById('recordInput').value.trim();
  if (!text) return alert('Please paste a patient record first.');

  const btn = document.getElementById('analyzeRecordBtn');
  btn.disabled = true;
  btn.textContent = '🔄 Analyzing...';

  try {
    const res  = await fetch(`${API_BASE}/api/analyze-records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_text: text })
    });
    const data = await res.json();
    if (data.success) renderRecordResults(data.analysis);
    else showError('recordResultsContent', data.error || 'Analysis failed');
  } catch (err) {
    showError('recordResultsContent', 'Server error: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = '🔍 Analyze Record';
}

function renderRecordResults(a) {
  document.getElementById('recordPlaceholder').classList.add('hidden');
  const el = document.getElementById('recordResultsContent');
  el.classList.remove('hidden');

  const renderTags = (items, cls, labelFn) => {
    if (!items || !items.length) return '<span style="color:var(--text-muted);font-size:0.82rem;">None found</span>';
    return `<div class="entity-tags">${items.map(i => `<span class="entity-tag ${cls}">${labelFn(i)}</span>`).join('')}</div>`;
  };

  const vitals    = a.vitals || {};
  const vitalKeys = ['blood_pressure','heart_rate','temperature','weight','bmi','oxygen_saturation'];
  const vitalLabels = ['Blood Pressure','Heart Rate','Temperature','Weight','BMI','O₂ Sat'];
  const riskScore = a.risk_score || {};
  const riskKeys  = ['cardiac','diabetes','respiratory'];

  el.innerHTML = `
    <h2 style="font-size:1rem;font-weight:800;margin-bottom:12px;">📄 NLP Analysis Results</h2>
    ${a.patient_summary ? `<div class="report-section info" style="margin-bottom:14px;">
      <div class="report-section-title">Patient Summary</div>
      <p style="font-size:0.88rem;color:var(--text-secondary);">${a.patient_summary}</p>
    </div>` : ''}

    <div class="entity-section">
      <div class="entity-label">🔴 Conditions</div>
      ${renderTags(a.conditions, 'tag-condition', c => `${c.name} <small style="opacity:0.7;">[${c.status||''}]</small>`)}
    </div>

    <div class="entity-section">
      <div class="entity-label">💊 Medications</div>
      ${renderTags(a.medications, 'tag-medication', m => `${m.name}${m.dosage && m.dosage!=='Not mentioned'?' — '+m.dosage:''}`)}
    </div>

    <div class="entity-section">
      <div class="entity-label">⚠️ Risk Factors</div>
      ${renderTags(a.risk_factors, 'tag-risk', r => r)}
    </div>

    <div class="entity-section">
      <div class="entity-label">🧪 Allergies</div>
      ${renderTags(a.allergies, 'tag-allergy', al => al)}
    </div>

    ${a.procedures && a.procedures.length ? `
    <div class="entity-section">
      <div class="entity-label">🏥 Procedures / Tests</div>
      ${renderTags(a.procedures, 'tag-procedure', p => p)}
    </div>` : ''}

    <hr class="section-divider" />
    <div class="entity-label">📊 Vitals</div>
    <div class="vitals-grid">
      ${vitalKeys.map((k, i) => {
        const val = vitals[k] || 'N/A';
        return `<div class="vital-item">
          <div class="vital-name">${vitalLabels[i]}</div>
          <div class="vital-value" style="color:${val==='Not mentioned'?'var(--text-muted)':'var(--teal)'};">${val}</div>
        </div>`;
      }).join('')}
    </div>

    ${(a.lab_results && a.lab_results.length) ? `
    <hr class="section-divider" />
    <div class="entity-label">🔬 Lab Results</div>
    ${a.lab_results.map(l => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:0.85rem;">${l.test}</span>
        <span style="font-size:0.85rem;font-weight:700;color:${l.status==='Abnormal'||l.status==='Critical'?'var(--red)':'var(--green)'};">
          ${l.value} <small style="opacity:0.7;">${l.status}</small>
        </span>
      </div>`).join('')}
    ` : ''}

    <hr class="section-divider" />
    <div class="entity-label">📈 Risk Scores</div>
    ${riskKeys.map(k => {
      const score = riskScore[k] || 0;
      const cls   = score < 30 ? 'risk-low' : score < 60 ? 'risk-medium' : 'risk-high';
      return `
      <div class="risk-bar-wrap">
        <div class="risk-bar-label">
          <span style="text-transform:capitalize;">${k} Risk</span>
          <span style="font-weight:700;">${score}%</span>
        </div>
        <div class="risk-bar-track">
          <div class="risk-bar-fill ${cls}" style="width:${score}%;"></div>
        </div>
      </div>`;
    }).join('')}

    ${(a.follow_up && a.follow_up.length) ? `
    <hr class="section-divider" />
    <div class="entity-label">📅 Follow-up Actions</div>
    <ul class="report-list" style="margin-top:8px;">${a.follow_up.map(f=>`<li>${f}</li>`).join('')}</ul>
    ` : ''}
  `;
}

// ════════════════════════════════════════
// RISK ASSESSMENT
// ════════════════════════════════════════
let riskChartInstance   = null;
let healthChartInstance = null;

async function runRiskAssessment() {
  const age       = parseInt(document.getElementById('mAge').value);
  const gender    = document.getElementById('mGender').value;
  const bp        = document.getElementById('mBP').value.trim();
  const glucose   = parseFloat(document.getElementById('mGlucose').value);
  const bmi       = parseFloat(document.getElementById('mBMI').value);
  const cholesterol = parseFloat(document.getElementById('mCholesterol').value);
  const symptoms  = document.getElementById('mSymptoms').value.trim();

  if (!age || !bp || isNaN(glucose) || isNaN(bmi) || isNaN(cholesterol)) {
    alert('Please fill in all health metrics fields.');
    return;
  }

  const btn = document.getElementById('assessBtn');
  btn.disabled = true;
  btn.textContent = '🔄 Analyzing...';

  try {
    const res = await fetch(`${API_BASE}/api/risk-assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age, gender, blood_pressure: bp, glucose, bmi, cholesterol, symptoms })
    });
    const data = await res.json();
    if (data.success) renderRiskResults(data.assessment);
    else showError('riskResultsContent', data.detail || 'Assessment failed');
  } catch (err) {
    showError('riskResultsContent', 'Server error: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = '🧬 Run Risk Assessment';
}

function renderRiskResults(a) {
  document.getElementById('riskPlaceholder').classList.add('hidden');
  const el = document.getElementById('riskResultsContent');
  el.classList.remove('hidden');

  const score  = a.overall_health_score || 0;
  const levels = a.risk_levels || {};
  const levelClass = l => (l||'Low').toLowerCase().replace(/\s/g,'-');

  el.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">Overall Health Score</div>
      <div style="font-size:3rem;font-weight:900;background:linear-gradient(135deg,var(--teal),var(--blue));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${score}</div>
      <div style="font-size:0.82rem;color:var(--text-muted);">out of 100</div>
    </div>

    <h3 style="font-size:0.85rem;font-weight:700;color:var(--teal);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">Risk Levels</h3>
    ${Object.entries(levels).map(([key, val]) => `
      <div class="risk-level-card ${levelClass(val.level)}">
        <div class="risk-level-name">${key}</div>
        <div class="risk-level-label">${val.level || 'Low'} Risk — ${val.score || 0}%</div>
        <div class="risk-level-detail">${val.details || ''}</div>
      </div>
    `).join('')}

    ${a.key_concerns && a.key_concerns.length ? `
    <hr class="section-divider" />
    <div class="entity-label mt-10">⚠️ Key Concerns</div>
    <ul class="report-list" style="margin-top:8px;">${a.key_concerns.map(c=>`<li>${c}</li>`).join('')}</ul>
    ` : ''}

    <hr class="section-divider" />
    <div class="entity-label mt-10">🏃 Lifestyle Recommendations</div>
    <div style="margin-top:10px;">
      ${(a.lifestyle_recommendations||[]).map(rec => `
        <div class="rec-card">
          <div>
            <div class="rec-category">${rec.category}</div>
            <div class="rec-text">${rec.recommendation}</div>
          </div>
          <span class="rec-priority ${rec.priority}">${rec.priority}</span>
        </div>
      `).join('')}
    </div>

    ${(a.screening_tests && a.screening_tests.length) ? `
    <hr class="section-divider" />
    <div class="entity-label mt-10">🔬 Recommended Screenings</div>
    <div style="margin-top:10px;">
      ${a.screening_tests.map(t => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border);">
          <div style="font-size:0.88rem;font-weight:600;">${t.test} <span style="font-size:0.8rem;color:var(--teal);font-weight:400;">(${t.frequency})</span></div>
          <div style="font-size:0.8rem;color:var(--text-muted);">${t.reason}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <hr class="section-divider" />
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;">
      📅 <strong>Follow-up:</strong> ${a.follow_up_timeline || 'Consult your physician.'}
    </div>
    <div class="disclaimer-box" style="margin-top:12px;">⚕ This assessment is AI-generated for informational purposes only. Always consult a licensed healthcare professional.</div>
  `;

  renderCharts(a);
}

function renderCharts(a) {
  document.getElementById('chartsRow').classList.remove('hidden');
  const levels = a.risk_levels || {};
  const ctx1   = document.getElementById('riskChart').getContext('2d');
  if (riskChartInstance) riskChartInstance.destroy();

  const labels = Object.keys(levels).map(l => l.charAt(0).toUpperCase() + l.slice(1));
  const values = Object.values(levels).map(v => v.score || 0);

  riskChartInstance = new Chart(ctx1, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Risk Score',
        data: values,
        backgroundColor: 'rgba(6,182,212,0.15)',
        borderColor: '#06b6d4',
        pointBackgroundColor: '#06b6d4',
        pointBorderColor: '#fff',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 100,
          grid: { color: 'rgba(99,179,237,0.1)' },
          ticks: { color: '#64748b', font: { size: 10 } },
          pointLabels: { color: '#94a3b8', font: { size: 11 } }
        }
      }
    }
  });

  const ctx2   = document.getElementById('healthChart').getContext('2d');
  if (healthChartInstance) healthChartInstance.destroy();
  const score  = a.overall_health_score || 0;

  healthChartInstance = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [score, 100-score],
        backgroundColor: ['#06b6d4', 'rgba(99,179,237,0.08)'],
        borderWidth: 0,
        borderRadius: 6,
      }]
    },
    options: {
      cutout: '72%',
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [{
      id: 'centerText',
      afterDraw(chart) {
        const { width, height, ctx } = chart;
        ctx.save();
        ctx.font = `800 ${Math.floor(height*0.18)}px Inter, sans-serif`;
        ctx.fillStyle = '#06b6d4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(score, width/2, height/2 - 8);
        ctx.font = `500 ${Math.floor(height*0.08)}px Inter, sans-serif`;
        ctx.fillStyle = '#64748b';
        ctx.fillText('/100', width/2, height/2 + height*0.12);
        ctx.restore();
      }
    }]
  });
}

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.classList.remove('hidden');
  const placeholder = el.previousElementSibling;
  if (placeholder) placeholder.classList.add('hidden');
  el.innerHTML = `
    <div style="text-align:center;padding:40px;color:var(--red);">
      <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
      <p style="font-size:0.9rem;">${msg}</p>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">Check that GEMINI_API_KEY is set in your .env file.</p>
    </div>
  `;
}
