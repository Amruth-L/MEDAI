# MedAI — Diagnostic Vision Platform


MedAI is an AI-powered healthcare diagnostic platform.
This is a practise project 
It helps analyze medical images (X-rays, MRIs, etc.), extract information from medical PDFs, and provides a chatbot assistant for medical queries. The platform uses Google Gemini AI for analysis and PyTorch (ResNet-50) to generate visual heatmaps (Grad-CAM) showing where the AI detected abnormalities.

## Features
- **Medical Image Analysis:** Upload an X-ray or medical image to see if it's Normal or Affected, along with a heatmap.
- **PDF Analyzer:** Upload lab reports or medical documents to extract key structured data.
- **Medical Chatbot:** Ask medical questions to the AI assistant.
- **Patient Records:** Paste clinical notes to extract conditions, medications, and vitals.
- **Risk Assessment:** Enter health metrics (like blood pressure and BMI) to get a personalized health risk score.

## How to Run the Project

1. **Navigate to the project directory:**
   Open your terminal and ensure you are in the project folder.

2. **Install dependencies:**
   Run the following command to install the required Python packages:
   ```bash
   pip3 install -r requirements.txt
   ```

3. **Set up the Environment Variables:**
   Create a `.env` file in the project directory and add your Google Gemini API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Start the Server:**
   Run the FastAPI server using Uvicorn:
   ```bash
   python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

5. **Open the Application:**
   Go to your web browser and open:
   `http://localhost:8000`

## Disclaimer
This project is for educational purposes only. It is not a certified medical device and must not be used for actual clinical diagnosis.
