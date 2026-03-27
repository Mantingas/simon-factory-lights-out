"""
Configurable noise dictionary for Product Title Noise Cleaner.

Edit the lists below to tune the cleaner for your catalogue.
All matches are case-insensitive unless noted.
"""

# ---------------------------------------------------------------------------
# Symbol / punctuation patterns (regex fragments, applied in order)
# ---------------------------------------------------------------------------
SYMBOL_PATTERNS = [
    r"[!]{2,}",          # !! !!!
    r"[*]{2,}",          # ** ***
    r"[#]{2,}",          # ## ###
    r"[~]{2,}",          # ~~ ~~~
    r"\|{2,}",           # ||
    r"-{3,}",            # --- (three or more dashes)
    r"={2,}",            # ==
    r"\^{2,}",           # ^^
    r">{2,}",            # >>
    r"<{2,}",            # <<
]

# ---------------------------------------------------------------------------
# Marketing / hype words (exact word-boundary match, case-insensitive)
# ---------------------------------------------------------------------------
MARKETING_WORDS = [
    "BEST",
    "NEW",
    "HOT",
    "SALE",
    "TOP",
    "PREMIUM",
    "SUPER",
    "AMAZING",
    "AWESOME",
    "EXCELLENT",
    "PERFECT",
    "ULTIMATE",
    "LIMITED OFFER",
    "SPECIAL OFFER",
    "GREAT",
    "FANTASTIC",
    "INCREDIBLE",
]

# ---------------------------------------------------------------------------
# Platform / promotional phrases (full phrase match, case-insensitive)
# ---------------------------------------------------------------------------
PROMO_PHRASES = [
    "BUY NOW",
    "FREE SHIPPING",
    "100% ORIGINAL",
    "SPECIAL OFFER",
    "BESTSELLER",
    "BEST SELLER",
    "TOP SELLER",
    "LIMITED TIME",
    "FAST DELIVERY",
    "SHIPS FREE",
    "SHIPS FAST",
    "ORDER NOW",
    "GET YOURS",
    "WHILE STOCKS LAST",
    "IN STOCK",
    "ON SALE",
    "CLEARANCE",
]

# ---------------------------------------------------------------------------
# Tokens that look like noise but are SAFE to keep
# (words that could be in MARKETING_WORDS but are legitimate product descriptors)
# ---------------------------------------------------------------------------
SAFE_WORDS = [
    "PROFESSIONAL",
    "PRO",
    "PLUS",
    "MAX",
    "MINI",
    "LITE",
    "AIR",
    "ULTRA",
]

# ---------------------------------------------------------------------------
# Patterns that strongly suggest a vendor/SKU junk token
# (applied only when the token is isolated and NOT the only content)
# ---------------------------------------------------------------------------
VENDOR_JUNK_PATTERNS = [
    r"^[A-Z]{1,4}\d{4,}$",          # e.g.  AB12345
    r"^\d{6,}$",                     # pure numeric, 6+ digits
    r"^[A-Z0-9]{8,}$",              # all-caps alphanumeric, 8+ chars
]

# ---------------------------------------------------------------------------
# Separator characters cleaned up during postprocessing
# ---------------------------------------------------------------------------
SEPARATOR_CHARS = ["|", "//", "\\\\"]
