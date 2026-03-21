import os
import json
import base64
import io
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from google import genai
from google.genai import types
from PIL import Image
from dotenv import load_dotenv

# Always load .env from the same directory as this file
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

app = FastAPI(title="Healthcare AI Platform", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL = "gemini-3.1-flash-lite-preview"

# ── Lazy-loaded Grad-CAM model ──
_resnet_model = None
_gradcam_available = False

def _load_gradcam():
    global _resnet_model, _gradcam_available
    if _resnet_model is not None:
        return _gradcam_available
    try:
        import torch
        import torchvision.models as tv_models
        model = tv_models.resnet50(weights=tv_models.ResNet50_Weights.IMAGENET1K_V1)
        model.eval()
        _resnet_model = model
        _gradcam_available = True
    except Exception as e:
        print(f"[GradCAM] PyTorch not available, heatmaps disabled: {e}")
        _gradcam_available = False
    return _gradcam_available

# ── Pydantic Models ──
class ChatMessage(BaseModel):
    message: str
    history: Optional[List[dict]] = []

class PatientRecord(BaseModel):
    record_text: str

class HealthMetrics(BaseModel):
    age: int
    gender: str
    blood_pressure: str
    glucose: float
    bmi: float
    cholesterol: float
    symptoms: str

def require_client():
    if not client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured. Add it to your .env file.")

def clean_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()

# ──────────────────────────────────────────────
# GRAD-CAM HEATMAP
# ──────────────────────────────────────────────
def compute_gradcam(image_bytes: bytes) -> Optional[str]:
    """Compute Grad-CAM heatmap. Returns base64-encoded PNG blend, or None on failure."""
    if not _load_gradcam():
        return None
    try:
        import torch
        import torchvision.transforms as T
        import numpy as np
        import cv2

        img_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        orig_w, orig_h = img_pil.size

        transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        inp = transform(img_pil).unsqueeze(0)

        gradients = []
        activations = []

        def fwd_hook(_, __, output):
            activations.append(output.detach())

        def bwd_hook(_, __, grad_output):
            gradients.append(grad_output[0].detach())

        h1 = _resnet_model.layer4.register_forward_hook(fwd_hook)
        h2 = _resnet_model.layer4.register_full_backward_hook(bwd_hook)

        out = _resnet_model(inp)
        cls_idx = int(out.argmax())
        _resnet_model.zero_grad()
        out[0, cls_idx].backward()

        h1.remove()
        h2.remove()

        grads = gradients[0].numpy()   # (1, C, H, W)
        acts  = activations[0].numpy() # (1, C, H, W)
        weights = np.mean(grads, axis=(2, 3), keepdims=True)
        cam = np.sum(weights * acts, axis=1)[0]
        cam = np.maximum(cam, 0)
        cam = cam / (cam.max() + 1e-8)

        cam_resized = cv2.resize(cam, (orig_w, orig_h))
        cam_uint8   = (cam_resized * 255).astype(np.uint8)
        heatmap     = cv2.applyColorMap(cam_uint8, cv2.COLORMAP_JET)

        orig_bgr = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
        blended  = cv2.addWeighted(orig_bgr, 0.55, heatmap, 0.45, 0)

        _, buf = cv2.imencode(".png", blended)
        return base64.b64encode(buf).decode("utf-8")
    except Exception as e:
        print(f"[GradCAM] Failed: {e}")
        return None

# ──────────────────────────────────────────────
# ROUTE: X-Ray / Medical Image Analysis
# ──────────────────────────────────────────────
@app.post("/api/analyze-xray")
async def analyze_xray(file: UploadFile = File(...)):
    require_client()
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))

        prompt = """You are an expert radiologist AI assistant. Analyze this medical image thoroughly.

Return ONLY valid JSON, no extra text:
{
  "classification": "Normal or Affected (one word only)",
  "classification_confidence": "High/Moderate/Low",
  "image_type": "Type of medical image and body part",
  "quality": "Image quality (Excellent/Good/Fair/Poor)",
  "findings": ["Finding 1", "Finding 2"],
  "abnormalities": ["Abnormality 1"],
  "affected_region": "Describe the specific region/area showing abnormality (or 'None detected' if Normal)",
  "impression": "Overall diagnostic impression in 2-3 sentences",
  "differential_diagnosis": ["Possible diagnosis 1", "Possible diagnosis 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "urgency": "Routine/Semi-urgent/Urgent/Emergency",
  "confidence": "High/Moderate/Low",
  "disclaimer": "This AI analysis is for educational purposes only and must be reviewed by a licensed radiologist."
}"""

        img_bytes_io = io.BytesIO()
        fmt = image.format or "JPEG"
        image.save(img_bytes_io, format=fmt)
        img_bytes_io.seek(0)
        img_data = img_bytes_io.read()

        response = client.models.generate_content(
            model=MODEL,
            contents=[
                types.Part.from_bytes(data=img_data, mime_type=file.content_type or "image/jpeg"),
                prompt
            ]
        )

        result = json.loads(clean_json(response.text))

        # Compute Grad-CAM heatmap
        heatmap_b64 = compute_gradcam(contents)
        result["heatmap_base64"] = heatmap_b64
        result["heatmap_available"] = heatmap_b64 is not None

        return JSONResponse(content={"success": True, "report": result})

    except json.JSONDecodeError:
        heatmap_b64 = compute_gradcam(contents)
        return JSONResponse(content={
            "success": True,
            "report": {
                "classification": "Affected",
                "classification_confidence": "Moderate",
                "image_type": "Medical Image",
                "quality": "Analyzed",
                "findings": [response.text],
                "abnormalities": [],
                "affected_region": "Unable to determine specific region",
                "impression": response.text,
                "differential_diagnosis": [],
                "recommendations": ["Consult a licensed radiologist."],
                "urgency": "Routine",
                "confidence": "Moderate",
                "disclaimer": "This AI analysis is for educational purposes only.",
                "heatmap_base64": heatmap_b64,
                "heatmap_available": heatmap_b64 is not None,
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# ROUTE: PDF Analyzer
# ──────────────────────────────────────────────
@app.post("/api/analyze-pdf")
async def analyze_pdf(file: UploadFile = File(...)):
    require_client()
    try:
        import fitz  # PyMuPDF
        contents = await file.read()
        pdf_doc  = fitz.open(stream=contents, filetype="pdf")

        text = ""
        page_count = pdf_doc.page_count
        for page in pdf_doc:
            text += page.get_text()
        pdf_doc.close()

        text = text.strip()
        if not text:
            return JSONResponse(content={
                "success": False,
                "error": "PDF contains no extractable text. It may be a scanned/image-based PDF."
            })

        # Truncate to avoid token limits
        text_snippet = text[:7000]

        prompt = f"""You are a medical AI specialist. Analyze this medical document and extract key structured information.

Document:
{text_snippet}

Return ONLY valid JSON:
{{
  "document_type": "Type of medical document (e.g. Lab Report, Discharge Summary, Prescription, Radiology Report)",
  "patient_summary": "1-2 sentence summary of the patient or document",
  "diagnoses": ["Diagnosis 1", "Diagnosis 2"],
  "key_findings": ["Finding 1", "Finding 2"],
  "medications": ["Medication 1 with dosage if available"],
  "lab_results": [{{"test": "Test name", "value": "Value", "status": "Normal/Abnormal/Critical"}}],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "risk_factors": ["Risk factor 1"],
  "urgency": "Routine/Semi-urgent/Urgent/Emergency",
  "follow_up": "Recommended follow-up action",
  "disclaimer": "This AI analysis is for educational purposes only."
}}"""

        response = client.models.generate_content(model=MODEL, contents=prompt)
        result   = json.loads(clean_json(response.text))
        return JSONResponse(content={"success": True, "analysis": result, "pages": page_count})

    except json.JSONDecodeError:
        return JSONResponse(content={"success": False, "error": "Failed to parse AI response.", "raw": response.text})
    except ImportError:
        raise HTTPException(status_code=500, detail="PyMuPDF not installed. Run: pip3 install PyMuPDF")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# ROUTE: Medical Chatbot
# ──────────────────────────────────────────────
@app.post("/api/chat")
async def medical_chat(payload: ChatMessage):
    require_client()
    try:
        system = """You are MedAI, an expert AI medical assistant. You help patients and healthcare professionals understand medical conditions, symptoms, medications, and treatments.

Guidelines:
- Provide accurate, evidence-based medical information
- Always recommend consulting a licensed physician for diagnosis and treatment
- Be empathetic and clear in your explanations
- Mention when symptoms require immediate medical attention
- NEVER replace professional medical advice"""

        history = []
        for msg in payload.history:
            role = "user" if msg.get("role") == "user" else "model"
            history.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.get("content", ""))]))

        chat = client.chats.create(model=MODEL, history=history, config=types.GenerateContentConfig(system_instruction=system))
        response = chat.send_message(payload.message)

        return JSONResponse(content={"success": True, "response": response.text, "role": "assistant"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# ROUTE: Patient Records NLP
# ──────────────────────────────────────────────
@app.post("/api/analyze-records")
async def analyze_records(payload: PatientRecord):
    require_client()
    try:
        prompt = f"""You are a clinical NLP expert. Analyze the following patient record and extract structured medical information.

Patient Record:
{payload.record_text}

Return ONLY valid JSON:
{{
  "patient_summary": "1-2 sentence summary",
  "conditions": [{{"name": "Condition", "status": "Active/Chronic/Resolved", "severity": "Mild/Moderate/Severe"}}],
  "medications": [{{"name": "Med name", "dosage": "Dosage or Not mentioned", "frequency": "Frequency or Not mentioned"}}],
  "vitals": {{
    "blood_pressure": "Value or Not mentioned",
    "heart_rate": "Value or Not mentioned",
    "temperature": "Value or Not mentioned",
    "weight": "Value or Not mentioned",
    "bmi": "Value or Not mentioned",
    "oxygen_saturation": "Value or Not mentioned"
  }},
  "risk_factors": ["Risk 1"],
  "allergies": ["Allergy 1"],
  "procedures": ["Procedure 1"],
  "lab_results": [{{"test": "Test name", "value": "Value", "status": "Normal/Abnormal/Critical"}}],
  "follow_up": ["Follow up 1"],
  "risk_score": {{"overall": 0, "cardiac": 0, "diabetes": 0, "respiratory": 0}}
}}"""

        response = client.models.generate_content(model=MODEL, contents=prompt)
        result   = json.loads(clean_json(response.text))
        return JSONResponse(content={"success": True, "analysis": result})

    except json.JSONDecodeError:
        return JSONResponse(content={"success": False, "error": "Failed to parse response", "raw": response.text})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# ROUTE: Risk Assessment
# ──────────────────────────────────────────────
@app.post("/api/risk-assessment")
async def risk_assessment(payload: HealthMetrics):
    require_client()
    try:
        prompt = f"""As a clinical AI, analyze these health metrics and provide a personalized risk assessment.

Patient Metrics:
- Age: {payload.age}
- Gender: {payload.gender}
- Blood Pressure: {payload.blood_pressure}
- Fasting Glucose: {payload.glucose} mg/dL
- BMI: {payload.bmi}
- Total Cholesterol: {payload.cholesterol} mg/dL
- Symptoms: {payload.symptoms}

Return ONLY valid JSON:
{{
  "overall_health_score": 0,
  "risk_levels": {{
    "cardiovascular": {{"score": 0, "level": "Low/Moderate/High/Very High", "details": "explanation"}},
    "diabetes": {{"score": 0, "level": "Low/Moderate/High/Very High", "details": "explanation"}},
    "hypertension": {{"score": 0, "level": "Low/Moderate/High/Very High", "details": "explanation"}},
    "obesity": {{"score": 0, "level": "Low/Moderate/High/Very High", "details": "explanation"}}
  }},
  "key_concerns": ["Concern 1"],
  "lifestyle_recommendations": [
    {{"category": "Diet", "recommendation": "advice", "priority": "High/Medium/Low"}},
    {{"category": "Exercise", "recommendation": "advice", "priority": "High/Medium/Low"}},
    {{"category": "Sleep", "recommendation": "advice", "priority": "High/Medium/Low"}},
    {{"category": "Stress", "recommendation": "advice", "priority": "High/Medium/Low"}}
  ],
  "screening_tests": [{{"test": "Test", "frequency": "How often", "reason": "Why"}}],
  "medication_considerations": "General medication considerations",
  "follow_up_timeline": "Recommended timeline"
}}

Score overall_health_score 0-100 (100 = excellent)."""

        response = client.models.generate_content(model=MODEL, contents=prompt)
        result   = json.loads(clean_json(response.text))
        return JSONResponse(content={"success": True, "assessment": result})

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# Static Files & Root
# ──────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    with open("static/index.html", "r") as f:
        return HTMLResponse(content=f.read())

@app.get("/health")
async def health():
    gradcam_ok = _load_gradcam()
    return {"status": "ok", "api_configured": bool(GEMINI_API_KEY), "gradcam_available": gradcam_ok}
