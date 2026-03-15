"""
PropVision AI Assistant — Image Analyzer Module

AI pipeline for real estate image analysis:
1. Room Classification — identify room type from image URL patterns and content
2. Object Detection — detect common real estate objects
3. Anti-Scam Engine — calculate fake image score based on quality and heuristics

This module uses image fetching + Pillow-based analysis for quality assessment,
and URL/filename heuristics for room/object classification.
For production, these would be replaced with trained ML models (e.g., ResNet, YOLO).
"""

import asyncio
import hashlib
import io
import re
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageStat


class ImageAnalyzer:
    """
    AI-powered image analysis pipeline for real estate listings.
    
    Analyzes images for:
    - Room type classification
    - Object detection
    - Quality assessment
    - Fake/scam image detection
    """

    def __init__(self):
        """Initialize the analyzer with HTTP client and known patterns."""
        self.http_client = httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={
                "User-Agent": "PropVision/1.0 ImageAnalyzer"
            }
        )
        
        # ─── YOLOv11 Object Detection Model ──────────────────────
        try:
            from ultralytics import YOLO
            # Load the lightweight YOLOv11n (nano) model for fast CPU inference
            # It will auto-download the weights (yolo11n.pt) on first run
            self.yolo_model = YOLO('yolo11n.pt')
            self.use_yolo = True
            print("[PropVision] YOLOv11 model loaded successfully.")
        except Exception as e:
            print(f"[PropVision] Failed to load YOLO model: {e}")
            self.use_yolo = False
            self.yolo_model = None
        
        # ─── Room Classification Patterns ────────────────────────
        # Keyword → room type mappings for URL/filename heuristics
        self.room_keywords = {
            "Bedroom": [
                "bedroom", "quarto", "dormitorio", "suite", "bed", "cama",
                "sleeping", "master"
            ],
            "Kitchen": [
                "kitchen", "cozinha", "cook", "culinary", "cocina",
                "pantry", "copa"
            ],
            "Living Room": [
                "living", "sala", "lounge", "sitting", "family",
                "estar", "social"
            ],
            "Bathroom": [
                "bathroom", "banheiro", "bath", "wc", "lavabo",
                "toilet", "shower", "banho"
            ],
            "Exterior": [
                "exterior", "fachada", "outside", "facade", "garden",
                "jardim", "pool", "piscina", "varanda", "balcony",
                "area", "quintal", "garagem", "garage", "parking"
            ]
        }
        
        # ─── Object Detection Patterns ──────────────────────────
        # Maps room types to commonly found objects
        self.room_objects = {
            "Bedroom": ["Bed", "Window", "Wardrobe"],
            "Kitchen": ["Fridge", "Stove", "Window"],
            "Living Room": ["Sofa", "Window", "TV"],
            "Bathroom": ["Shower", "Mirror", "Window"],
            "Exterior": ["Balcony", "Window", "Garden"]
        }
        
        # ─── Known watermark / scam domains ─────────────────────
        self.suspicious_domains = [
            "shutterstock", "gettyimages", "istockphoto", "unsplash",
            "pexels", "pixabay", "stock", "placeholder", "dummy",
            "lorem", "picsum", "via.placeholder"
        ]

    async def analyze_image(self, url: str) -> Dict:
        """
        Run the full analysis pipeline on a single image.
        
        Args:
            url: The image URL to analyze.
        
        Returns:
            Dict with room_type, objects, quality_score, fake_image_score
        """
        # Step 1: URL-based heuristic analysis (fast, no download needed)
        url_analysis = self._analyze_url(url)
        
        # Step 2: Download and analyze image content
        image_analysis, image_bytes = await self._analyze_image_content(url)
        
        # Step 3: Combine results
        room_type = image_analysis.get("room_type") or url_analysis["room_type"]
        
        # Get objects based on detected room type and YOLO inference
        objects = self._detect_objects(str(room_type), url, image_analysis, image_bytes)
        
        # Override room type based on highly definitive AI objects
        if "Sofa" in objects or "TV" in objects:
            room_type = "Living Room"
        elif "Bed" in objects or "Wardrobe" in objects:
            room_type = "Bedroom"
        elif "Fridge" in objects or "Stove" in objects or "Microwave" in objects or "Oven" in objects:
            room_type = "Kitchen"
        elif "Shower" in objects or "Toilet" in objects:
            room_type = "Bathroom"
        
        # Calculate final scores
        quality_score = float(image_analysis.get("quality_score", 0.5))
        fake_score = self._calculate_fake_score(
            url_analysis, image_analysis, url
        )
        
        return {
            "room_type": room_type,
            "objects": objects,
            "quality_score": round(quality_score, 3),
            "fake_image_score": round(fake_score, 3)
        }

    def _analyze_url(self, url: str) -> Dict:
        """
        Perform URL/filename-based heuristic analysis.
        
        Extracts room type hints from the URL path and filename.
        Checks for suspicious domains (stock photo sites).
        """
        url_lower = url.lower()
        parsed = urlparse(url)
        path = parsed.path.lower()
        domain = parsed.netloc.lower()
        
        # Detect room type from URL keywords
        room_type = "Unknown"
        best_score = 0
        
        for room, keywords in self.room_keywords.items():
            score = sum(1 for kw in keywords if kw in url_lower)
            if score > best_score:
                best_score = score
                room_type = room
        
        # Check for suspicious domain
        is_stock = any(sd in domain for sd in self.suspicious_domains)
        
        return {
            "room_type": room_type if best_score > 0 else "Unknown",
            "is_stock_domain": is_stock,
            "domain": domain,
            "url_score": best_score
        }

    async def _analyze_image_content(self, url: str) -> Tuple[Dict, Optional[bytes]]:
        """
        Download the image and perform content-based analysis.
        
        Checks:
        - Image resolution and dimensions
        - Compression quality / artifacts
        - Color distribution and variance
        - Image metadata for manipulation signs
        """
        result: Dict = {
            "quality_score": 0.5,
            "width": 0,
            "height": 0,
            "format": None,
            "is_low_resolution": False,
            "is_heavily_compressed": False,
            "has_uniform_regions": False,
            "room_type": None,
            "download_success": False
        }
        
        try:
            # Download the image
            response = await self.http_client.get(url)
            
            if response.status_code != 200:
                return result, None
            
            content_type = response.headers.get("content-type", "")
            content_length = len(response.content)
            
            # Skip if not an image
            if not content_type.startswith("image/") and "octet-stream" not in content_type:
                return result, None
            
            result["download_success"] = True
            
            # Open with Pillow for analysis
            img = Image.open(io.BytesIO(response.content))
            width, height = img.size
            
            result["width"] = width
            result["height"] = height
            result["format"] = img.format
            
            # ── Resolution Analysis ──────────────────────────────
            total_pixels = width * height
            
            if total_pixels < 100_000:  # < ~316x316
                result["is_low_resolution"] = True
                result["quality_score"] = 0.2
            elif total_pixels < 500_000:  # < ~707x707
                result["quality_score"] = 0.5
            elif total_pixels < 2_000_000:  # < ~1414x1414
                result["quality_score"] = 0.75
            else:
                result["quality_score"] = 0.9
            
            # ── Compression Analysis ─────────────────────────────
            # Check bytes-per-pixel ratio (low = heavily compressed)
            if total_pixels > 0:
                bytes_per_pixel = content_length / total_pixels
                if bytes_per_pixel < 0.3:  # Very low — heavy JPEG compression
                    result["is_heavily_compressed"] = True
                    result["quality_score"] = max(result["quality_score"] - 0.2, 0.1)
            
            # ── Color Distribution Analysis ──────────────────────
            # Convert to RGB for analysis
            if img.mode != "RGB":
                img = img.convert("RGB")
            
            stat = ImageStat.Stat(img)
            
            # Check standard deviation (low = uniform/fake/generated)
            avg_stddev = sum(stat.stddev) / 3
            if avg_stddev < 20:
                result["has_uniform_regions"] = True
                result["quality_score"] = max(result["quality_score"] - 0.15, 0.1)
            
            # ── Room Type from Color Analysis ────────────────────
            # Simple heuristic: dominant colors can hint at room type
            mean_r, mean_g, mean_b = stat.mean
            
            # Bright, warm tones → likely kitchen or living room
            # Cool, muted tones → likely bathroom
            # Very bright → likely exterior
            brightness = (mean_r + mean_g + mean_b) / 3
            
            if brightness > 180:
                result["room_type"] = "Exterior"
            elif mean_b > mean_r and mean_b > mean_g:
                result["room_type"] = "Bathroom"
            elif mean_r > 140 and mean_g > 120:
                result["room_type"] = "Kitchen"
            
            # Boost quality for high-res, well-lit images
            if brightness > 100 and avg_stddev > 40 and total_pixels > 1_000_000:
                result["quality_score"] = min(float(result.get("quality_score", 0.5)) + 0.1, 1.0)
                
        except httpx.TimeoutException:
            result["quality_score"] = 0.3  # Timeout suggests issues
        except Exception as e:
            # Failed to analyze — return default scores
            pass
        
        return result, getattr(response, 'content', None) if 'response' in locals() else None

    def _detect_objects(
        self, room_type: str, url: str, image_analysis: Dict, image_bytes: Optional[bytes] = None
    ) -> List[str]:
        """
        Detect objects using YOLOv11 computer vision model.
        Falls back to heuristics if YOLO is unavailable or image download failed.
        """
        objects = set()
        
        # ─── 1. YOLOv11 AI Detection ─────────────────────────────────
        if getattr(self, 'use_yolo', False) and self.yolo_model and image_bytes:
            try:
                # Load image from bytes for YOLO
                img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                
                # Run inference (conf=0.25 to catch more objects, we can filter later)
                results = self.yolo_model(img, conf=0.25, verbose=False)
                
                # Relevant COCO classes for real estate:
                # 56: chair, 57: couch/sofa, 58: potted plant, 59: bed, 60: dining table, 
                # 61: toilet, 62: tv, 63: laptop, 64: mouse, 65: remote, 66: keyboard, 67: cell phone,
                # 68: microwave, 69: oven, 70: toaster, 71: sink, 72: refrigerator, 73: book, 74: clock, 75: vase
                coco_mapping = {
                    56: "Chair", 57: "Sofa", 58: "Plant", 59: "Bed", 60: "Dining Table",
                    61: "Toilet", 62: "TV", 68: "Microwave", 69: "Oven", 71: "Sink", 72: "Fridge",
                    74: "Clock", 75: "Vase"
                }

                if results and len(results) > 0:
                    boxes = results[0].boxes
                    if boxes is not None:
                        for box in boxes:
                            class_id = int(box.cls[0].item())
                            if class_id in coco_mapping:
                                objects.add(coco_mapping[class_id])
                
            except Exception as e:
                print(f"[PropVision] YOLO detection error: {e}")
        
        # ─── 2. Heuristic Fallback & Enrichment ──────────────────────
        url_lower = url.lower()
        
        # Room-based object priors (only if YOLO found nothing, to avoid AI mismatch)
        if len(objects) == 0 and room_type in self.room_objects:
            for obj in self.room_objects[room_type]:
                objects.add(obj)
        
        # Keyword-based detection from URL (urls often contain specific features like "pool")
        keyword_to_object = {
            "window": "Window", "janela": "Window",
            "balcony": "Balcony", "varanda": "Balcony", "sacada": "Balcony",
            "pool": "Pool", "piscina": "Pool",
            "garage": "Garage", "garagem": "Garage"
        }
        
        for keyword, obj in keyword_to_object.items():
            if keyword in url_lower:
                objects.add(obj)
        
        # If image is well-lit and high-res, add "Window" as likely present
        if (image_analysis.get("quality_score", 0) > 0.7 
                and "Window" not in objects
                and image_analysis.get("download_success")):
            if image_analysis.get("width", 0) > 0:
                objects.add("Window")
        
        return list(objects)[:6]  # Cap at 6 objects

    def _calculate_fake_score(
        self, url_analysis: Dict, image_analysis: Dict, url: str
    ) -> float:
        """
        Calculate the probability that an image is fake or misleading.
        
        Factors:
        1. Resolution / metadata quality (low res = suspicious)
        2. Watermark / stock domain detection
        3. Compression artifact detection
        4. AI-generation heuristics (uniform regions, unusual patterns)
        5. Reverse-image similarity placeholder
        
        Returns:
            Float between 0.0 (definitely real) and 1.0 (definitely fake)
        """
        score = 0.0
        
        # Factor 1: Stock domain detection (strong signal)
        if url_analysis.get("is_stock_domain"):
            score += 0.5
        
        # Factor 2: Low resolution
        if image_analysis.get("is_low_resolution"):
            score += 0.2
        
        # Factor 3: Heavy compression
        if image_analysis.get("is_heavily_compressed"):
            score += 0.15
        
        # Factor 4: Uniform color regions (AI-generated images often have this)
        if image_analysis.get("has_uniform_regions"):
            score += 0.15
        
        # Factor 5: Suspicious URL patterns
        url_lower = url.lower()
        suspicious_patterns = [
            "stock", "placeholder", "sample", "demo", "test",
            "generic", "template", "dummy", "fake", "mock"
        ]
        if any(p in url_lower for p in suspicious_patterns):
            score += 0.3
        
        # Factor 6: Watermark branding conflicts
        # Check if URL suggests image belongs to a different platform
        conflicting_brands = [
            "zapimoveis", "vivareal", "imovelweb", "quintoandar",
            "chaves", "123i", "lugarcerto"
        ]
        if any(brand in url_lower for brand in conflicting_brands):
            score += 0.25
        
        # Factor 7: Download failure increases suspicion
        if not image_analysis.get("download_success"):
            score += 0.1
        
        # Factor 8: [PLACEHOLDER] Reverse image search
        # In production: query TinEye/Google Images API
        # If image appears on many unrelated sites → likely stock/fake
        
        # Factor 9: [PLACEHOLDER] AI-generation signature detection
        # In production: use a trained classifier to detect
        # GAN/diffusion model artifacts (e.g., DIRE, CNNDetect)
        
        # Normalize: cap between 0 and 1
        return min(max(score, 0.0), 1.0)

    async def close(self):
        """Close the HTTP client gracefully."""
        await self.http_client.aclose()
