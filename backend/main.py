"""
PropVision AI Assistant — FastAPI Backend
Main Application Entry Point

Provides the /analyze-images endpoint for the Chrome extension.
Handles CORS, request validation, and routes to the analysis pipeline.

Usage:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

from analyzer import ImageAnalyzer

# ─── FastAPI App Setup ───────────────────────────────────────────────
app = FastAPI(
    title="PropVision AI Backend",
    description="AI-powered real estate image analysis API for the PropVision Chrome extension.",
    version="1.0.0"
)

# ─── CORS Configuration ─────────────────────────────────────────────
# Allow requests from Chrome extension and local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",  # Chrome extension origin
        "http://localhost:*",     # Local dev
        "https://www.olx.in",     # OLX India
        "https://*.olx.in", 
        "*"                       # Fallback for development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Initialize the AI Analyzer ─────────────────────────────────────
analyzer = ImageAnalyzer()


# ─── Request / Response Models ───────────────────────────────────────
class AnalyzeRequest(BaseModel):
    """Request body for the /analyze-images endpoint."""
    image_urls: List[str]


class ImageResult(BaseModel):
    """Analysis result for a single image."""
    image_url: str
    room_type: str
    objects: List[str]
    quality_score: float
    fake_image_score: float


class AnalyzeResponse(BaseModel):
    """Response body containing all image analysis results."""
    results: List[ImageResult]
    total_images: int
    suspicious_count: int


# ─── Health Check ────────────────────────────────────────────────────
@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "PropVision AI Backend",
        "status": "active",
        "version": "1.0.0"
    }


@app.get("/health")
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "analyzer_ready": True
    }


# ─── Main Analysis Endpoint ─────────────────────────────────────────
@app.post("/analyze-images", response_model=AnalyzeResponse)
async def analyze_images(request: AnalyzeRequest):
    """
    Analyze a batch of property listing images.
    
    Performs:
    - Room type classification (Bedroom, Kitchen, Living Room, Bathroom, Exterior)
    - Object detection (Bed, Sofa, Fridge, Stove, Window, Balcony)
    - Anti-scam analysis (quality score, fake image detection)
    
    Args:
        request: JSON body with {"image_urls": ["url1", "url2", ...]}
    
    Returns:
        JSON with per-image results and summary statistics.
    """
    if not request.image_urls:
        raise HTTPException(status_code=400, detail="No image URLs provided")
    
    if len(request.image_urls) > 50:
        raise HTTPException(
            status_code=400, 
            detail="Maximum 50 images per request. Please batch your requests."
        )
    
    # Run analysis pipeline on each image
    results = []
    for url in request.image_urls:
        try:
            result = await analyzer.analyze_image(url)
            results.append(ImageResult(
                image_url=url,
                room_type=result["room_type"],
                objects=result["objects"],
                quality_score=result["quality_score"],
                fake_image_score=result["fake_image_score"]
            ))
        except Exception as e:
            # On failure for a single image, return partial result with error indicators
            results.append(ImageResult(
                image_url=url,
                room_type="Unknown",
                objects=[],
                quality_score=0.0,
                fake_image_score=0.5  # Uncertain — flag as caution
            ))
    
    # Calculate summary stats
    suspicious_count = sum(1 for r in results if r.fake_image_score >= 0.7)
    
    return AnalyzeResponse(
        results=results,
        total_images=len(results),
        suspicious_count=suspicious_count
    )
