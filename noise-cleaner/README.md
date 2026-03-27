# Product Title Noise Cleaner

A lightweight tool to detect and remove obvious noise from e-commerce product titles — without rewriting or hallucinating.

## What it does

Removes only clear garbage:
- Symbol clutter: `!!!`, `***`, `###`, `---`
- Marketing fluff: `BEST`, `NEW`, `HOT`, `SALE`, `TOP`, `PREMIUM`
- Promo phrases: `FREE SHIPPING`, `BUY NOW`, `100% ORIGINAL`, `SPECIAL OFFER`
- Duplicate consecutive tokens
- Vendor junk / isolated SKU noise (via optional AI layer)

Preserves everything that matters:
- Brand, model, series
- Size, volume, quantity
- Colour, material, variant
- Power / capacity notation

## Architecture

```
Input title
    │
    ▼
Stage 1: Symbol clutter removal (regex)
    │
    ▼
Stage 2: Promo phrase removal (dictionary)
    │
    ▼
Stage 3: Marketing word removal (dictionary)
    │
    ▼
Stage 4: Separator cleanup
    │
    ▼
Stage 5: Duplicate token removal
    │
    ▼
Stage 6: Vendor junk removal (regex)
    │
    ▼
Stage 7: AI pass for borderline tokens (optional — requires OPENAI_API_KEY)
    │
    ▼
Stage 8: Normalise whitespace / separators
    │
    ▼
Output JSON
```

The AI layer (Stage 7) is entirely optional. Without `OPENAI_API_KEY`, all decisions are deterministic. Borderline tokens are flagged with `contains_uncertainty: true` instead of being incorrectly removed.

## Project structure

```
noise-cleaner/
├── backend/
│   ├── main.py          # FastAPI app
│   ├── cleaner.py       # Core cleaning pipeline
│   ├── noise_dict.py    # Configurable noise dictionary ← edit this
│   └── schemas.py       # Pydantic models
├── frontend/
│   └── index.html       # Minimal UI (served by FastAPI)
├── tests/
│   └── test_cleaner.py  # Unit tests (34 cases)
├── examples/
│   └── sample_titles.csv
└── README.md
```

## Local setup

```bash
# 1. Install dependencies
pip install fastapi uvicorn[standard] openai pandas pydantic python-multipart aiofiles

# 2. (Optional) Set OpenAI key for AI-assisted borderline token detection
export OPENAI_API_KEY=sk-...

# 3. Start server
cd noise-cleaner
uvicorn backend.main:app --reload

# 4. Open in browser
open http://localhost:8000
```

## API

### `POST /clean-title`

Single title cleaning.

**Request:**
```json
{ "title": "Bosch GSB 18V-50 Professional Cordless Drill !!! BEST SALE" }
```

**Response:**
```json
{
  "original_title": "Bosch GSB 18V-50 Professional Cordless Drill !!! BEST SALE",
  "cleaned_title": "Bosch GSB 18V-50 Professional Cordless Drill",
  "noise_found": true,
  "removed_tokens": ["!!!", "Best", "Sale"],
  "noise_categories": ["symbol_clutter", "marketing_noise"],
  "confidence_score": 94,
  "contains_uncertainty": false
}
```

### `POST /clean-bulk`

Upload a CSV with a `title` column. Returns a downloadable cleaned CSV.

**CSV columns returned:**
- Original Title
- Cleaned Title
- Noise Found
- Removed Tokens
- Noise Categories
- Confidence Score
- Contains Uncertainty

### `POST /clean-bulk-preview`

Same as `/clean-bulk` but returns JSON for table preview in the UI.

## Running tests

```bash
cd /path/to/repo
python3 -m pytest noise-cleaner/tests/ -v
```

## Customising noise rules

Edit `noise-cleaner/backend/noise_dict.py`:

- `MARKETING_WORDS` — add/remove hype words
- `PROMO_PHRASES` — add/remove promotional phrases
- `SAFE_WORDS` — words that look like noise but must be preserved (`PROFESSIONAL`, `PRO`, `ULTRA`, etc.)
- `SYMBOL_PATTERNS` — regex for symbol clutter
- `VENDOR_JUNK_PATTERNS` — regex for isolated SKU/vendor codes
