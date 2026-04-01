<p align="center">
  <img src="icons/icon128.png" alt="PropVision AI Logo" width="100" />
</p>

<h1 align="center">PropVision AI Assistant</h1>

<p align="center">
  <strong>AI-powered Chrome Extension for Real Estate Image Analysis & Scam Detection</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/YOLOv11-Object_Detection-FF6F00?style=for-the-badge&logo=pytorch&logoColor=white" alt="YOLOv11" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

---

## 📖 Overview

**PropVision AI** is a Chrome Extension that brings computer-vision-powered intelligence to online real estate browsing. When you visit property listings on **OLX.in**, PropVision automatically discovers all listing images, analyzes them using an AI backend, and overlays actionable insights — room classification, detected objects, image quality scores, and **fake/scam image warnings** — directly onto the page.

### ✨ Key Features

| Feature | Description |
|---|---|
| 🔍 **Smart Image Discovery** | MutationObserver-based DOM scanner that detects both `<img>` and `background-image` elements, including lazy-loaded content |
| 🏠 **Room Classification** | AI-powered classification into Bedroom, Kitchen, Living Room, Bathroom, and Exterior categories |
| 🎯 **Object Detection (YOLOv11)** | Real-time detection of furniture and fixtures (Bed, Sofa, Fridge, TV, Toilet, etc.) using YOLOv11 nano model |
| 🛡️ **Anti-Scam Engine** | Multi-factor fake image scoring — detects stock photos, heavy compression, AI-generated content, and watermarked images |
| 📊 **Dashboard Popup** | Clean popup UI with summary cards, detailed per-image breakdowns, and quality bar visualizations |
| ⚡ **On-Page Badges** | Floating badges injected directly onto listing images showing real-time analysis status |

---

## 🏗️ Architecture

```
PropVision_Extension/
│
├── manifest.json          # Chrome Extension manifest (V3)
├── background.js          # Service worker — proxies API calls to bypass mixed content
├── content.js             # Content script — image discovery, badge injection, analysis orchestration
├── popup.html             # Extension popup dashboard layout
├── popup.js               # Popup logic — scan/analyze controls, results rendering
├── popup.css              # Popup dashboard styles
├── styles.css             # Content script injected styles (badges, overlays)
│
├── icons/
│   ├── icon16.png         # Toolbar icon (16×16)
│   ├── icon48.png         # Extension management icon (48×48)
│   └── icon128.png        # Chrome Web Store icon (128×128)
│
└── backend/
    ├── main.py            # FastAPI application — /analyze-images endpoint
    ├── analyzer.py        # AI pipeline — room classification, YOLO detection, anti-scam engine
    └── requirements.txt   # Python dependencies
```

---

## 🚀 Getting Started

### Prerequisites

- **Google Chrome** (v115+)
- **Python** 3.10 or higher
- **pip** (Python package manager)

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/PropVision_Extension.git
cd PropVision_Extension
```

### 2. Set Up the Backend

```bash
# Navigate to backend directory
cd backend

# Create a virtual environment (recommended)
python -m venv venv

# Activate the virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install YOLOv11 (Ultralytics) for object detection
pip install ultralytics
```

### 3. Start the Backend Server

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

The API server will be running at `http://localhost:8001`. Verify by visiting the health endpoint:

```
GET http://localhost:8001/health
→ { "status": "healthy", "analyzer_ready": true }
```

> **Note:** On first run, the YOLOv11 nano model weights (`yolo11n.pt`, ~5.6 MB) will be automatically downloaded.

### 4. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `PropVision_Extension` root folder (the one containing `manifest.json`)
5. The PropVision icon will appear in your Chrome toolbar

---

## 🎮 Usage

1. **Navigate** to any property listing on [OLX.in](https://www.olx.in)
2. **Click** the PropVision icon in the toolbar to open the popup dashboard
3. **Scan Page** — discovers all qualifying listing images (>300px, filters out icons/ads)
4. **Analyze Images** — sends discovered images to the FastAPI backend for AI analysis
5. **View Results** — summary cards show totals, room counts, and suspicious image alerts; detailed per-image breakdowns are listed below

### On-Page Badges

PropVision injects floating badges directly onto listing images:

| Badge Status | Meaning |
|---|---|
| 🟢 `✓ Safe` | Image appears authentic (fake score < 40%) |
| 🟡 `⚡ Caution` | Some red flags detected (fake score 40–70%) |
| 🔴 `⚠ Suspicious` | Likely fake or misleading (fake score ≥ 70%) |

---

## 🔌 API Reference

### `POST /analyze-images`

Analyze a batch of property listing images.

**Request Body:**
```json
{
  "image_urls": [
    "https://example.com/image1.jpg",
    "https://example.com/image2.jpg"
  ]
}
```

**Response:**
```json
{
  "results": [
    {
      "image_url": "https://example.com/image1.jpg",
      "room_type": "Bedroom",
      "objects": ["Bed", "Window", "Wardrobe"],
      "quality_score": 0.85,
      "fake_image_score": 0.12
    }
  ],
  "total_images": 1,
  "suspicious_count": 0
}
```

**Limits:** Maximum 50 images per request.

### `GET /health`

Health check endpoint.

### `GET /`

Service info and version.

---

## 🧠 AI Pipeline

The analysis engine in `analyzer.py` runs a three-stage pipeline on each image:

### Stage 1 — Room Classification
- **URL Heuristics:** Keyword matching against the image URL/filename for room type hints
- **Color Analysis:** Pillow-based mean color and brightness analysis to infer room category
- **YOLO Override:** If high-confidence objects are detected (e.g., Bed → Bedroom, Sofa → Living Room), the room type is overridden

### Stage 2 — Object Detection
- **YOLOv11 Nano Model:** Real-time inference on downloaded images using COCO-trained weights
- **Detected Classes:** Chair, Sofa, Plant, Bed, Dining Table, Toilet, TV, Microwave, Oven, Sink, Fridge, Clock, Vase
- **Heuristic Fallback:** If YOLO is unavailable or fails, room-type-based object priors are used

### Stage 3 — Anti-Scam Engine
Multi-factor scoring system (0.0 = definitely real → 1.0 = definitely fake):

| Factor | Weight | Description |
|---|---|---|
| Stock domain | +0.50 | Image hosted on Shutterstock, Unsplash, etc. |
| Suspicious URL patterns | +0.30 | URL contains "stock", "placeholder", "demo", etc. |
| Conflicting brands | +0.25 | Image appears to come from a competing platform |
| Low resolution | +0.20 | Image under ~316×316 pixels |
| Heavy compression | +0.15 | Very low bytes-per-pixel ratio |
| Uniform color regions | +0.15 | Flat, synthetic-looking color distribution |
| Download failure | +0.10 | Image URL is unreachable or broken |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Extension** | Chrome Manifest V3, Vanilla JavaScript |
| **Styling** | Vanilla CSS with custom properties |
| **Backend** | Python, FastAPI, Uvicorn |
| **AI / CV** | YOLOv11 (Ultralytics), Pillow |
| **HTTP Client** | httpx (async) |
| **Communication** | Chrome Messaging API (content ↔ popup ↔ background) |

---

## 📋 Dependencies

### Backend (`requirements.txt`)

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.115.0 | API framework |
| `uvicorn[standard]` | 0.30.0 | ASGI server |
| `httpx` | 0.27.0 | Async HTTP client for image downloads |
| `Pillow` | 10.4.0 | Image analysis (resolution, color, quality) |
| `python-multipart` | 0.0.9 | Form data parsing |
| `ultralytics` | latest | YOLOv11 object detection *(install separately)* |

### Extension

No external dependencies — pure Vanilla JavaScript and CSS.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m "Add amazing feature"`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Ideas for Contribution

- 🔬 Train custom room classification models (ResNet / EfficientNet)
- 🔗 Integrate reverse image search (TinEye / Google Images API)
- 🤖 Add AI-generated image detection (DIRE, CNNDetect)
- 🌍 Extend support to other property listing sites (99acres, MagicBricks, Housing.com)
- 📱 Add browser action badge counts

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Ajay Vairam**

---

<p align="center">
  <sub>Built with ❤️ for safer online real estate browsing</sub>
</p>
