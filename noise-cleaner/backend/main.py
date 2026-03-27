"""
Product Title Noise Cleaner — FastAPI backend.

Endpoints:
    POST /clean-title   — single title (JSON in, JSON out)
    POST /clean-bulk    — CSV upload, CSV download
    GET  /              — serve frontend
"""

import csv
import io
import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .cleaner import clean_title
from .schemas import BulkCleanResponse, CleanRequest, CleanResult

app = FastAPI(
    title="Product Title Noise Cleaner",
    description="Detect and remove obvious noise from e-commerce product titles.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# ---------------------------------------------------------------------------
# Single title
# ---------------------------------------------------------------------------

@app.post("/clean-title", response_model=CleanResult)
def clean_single(req: CleanRequest) -> CleanResult:
    return clean_title(req.title)


# ---------------------------------------------------------------------------
# Bulk CSV
# ---------------------------------------------------------------------------

@app.post("/clean-bulk")
async def clean_bulk(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or "title" not in reader.fieldnames:
        raise HTTPException(
            status_code=422,
            detail="CSV must contain a column named 'title'.",
        )

    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=422, detail="CSV has no data rows.")

    results: List[CleanResult] = [clean_title(row["title"]) for row in rows]

    # Build output CSV
    output = io.StringIO()
    fieldnames = [
        "Original Title",
        "Cleaned Title",
        "Noise Found",
        "Removed Tokens",
        "Noise Categories",
        "Confidence Score",
        "Contains Uncertainty",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for r in results:
        writer.writerow({
            "Original Title": r.original_title,
            "Cleaned Title": r.cleaned_title,
            "Noise Found": r.noise_found,
            "Removed Tokens": "; ".join(r.removed_tokens),
            "Noise Categories": "; ".join(r.noise_categories),
            "Confidence Score": r.confidence_score,
            "Contains Uncertainty": r.contains_uncertainty,
        })

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cleaned_titles.csv"},
    )


# ---------------------------------------------------------------------------
# Preview endpoint (returns JSON for bulk, used by frontend table)
# ---------------------------------------------------------------------------

@app.post("/clean-bulk-preview", response_model=BulkCleanResponse)
async def clean_bulk_preview(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or "title" not in reader.fieldnames:
        raise HTTPException(
            status_code=422,
            detail="CSV must contain a column named 'title'.",
        )

    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=422, detail="CSV has no data rows.")

    results = [clean_title(row["title"]) for row in rows]
    noise_count = sum(1 for r in results if r.noise_found)

    return BulkCleanResponse(
        results=results,
        total=len(results),
        noise_found_count=noise_count,
    )


# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return HTMLResponse(content=index.read_text(), status_code=200)
    return HTMLResponse(content="<h1>Frontend not found</h1>", status_code=404)
