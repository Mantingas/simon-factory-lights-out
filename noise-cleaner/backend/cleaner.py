"""
Core cleaning logic for Product Title Noise Cleaner.

Architecture:
    1. Deterministic preprocessing  — regex + dictionary rules
    2. AI layer (optional)          — OpenAI only for borderline tokens
    3. Deterministic postprocessing — whitespace / separator normalisation

The AI layer is skipped entirely when OPENAI_API_KEY is not set.
"""

import os
import re
from typing import List, Tuple

from .noise_dict import (
    MARKETING_WORDS,
    PROMO_PHRASES,
    SAFE_WORDS,
    SYMBOL_PATTERNS,
    VENDOR_JUNK_PATTERNS,
    SEPARATOR_CHARS,
)
from .schemas import CleanResult

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SAFE_WORDS_UPPER = {w.upper() for w in SAFE_WORDS}
_MARKETING_UPPER = sorted(
    [w.upper() for w in MARKETING_WORDS], key=len, reverse=True
)
_PROMO_UPPER = sorted(
    [p.upper() for p in PROMO_PHRASES], key=len, reverse=True
)


def _compile_word_pattern(word: str) -> re.Pattern:
    """Word-boundary pattern, case-insensitive."""
    escaped = re.escape(word)
    return re.compile(r"(?<![A-Za-z0-9])" + escaped + r"(?![A-Za-z0-9])", re.IGNORECASE)


_MARKETING_PATTERNS = [(_compile_word_pattern(w), w) for w in _MARKETING_UPPER]
_PROMO_PATTERNS = [(_compile_word_pattern(p), p) for p in _PROMO_UPPER]
_VENDOR_COMPILED = [re.compile(p) for p in VENDOR_JUNK_PATTERNS]
_SYMBOL_COMPILED = [re.compile(p) for p in SYMBOL_PATTERNS]


# ---------------------------------------------------------------------------
# Stage 1 — symbol clutter
# ---------------------------------------------------------------------------

def _remove_symbol_clutter(title: str) -> Tuple[str, List[str]]:
    removed = []
    for pattern in _SYMBOL_COMPILED:
        for match in pattern.finditer(title):
            token = match.group(0)
            if token not in removed:
                removed.append(token)
        title = pattern.sub(" ", title)
    return title, removed


# ---------------------------------------------------------------------------
# Stage 2 — promo phrases (longer ones first to avoid partial matches)
# ---------------------------------------------------------------------------

def _remove_promo_phrases(title: str) -> Tuple[str, List[str]]:
    removed = []
    for pattern, phrase in _PROMO_PATTERNS:
        if pattern.search(title):
            removed.append(phrase.title())
            title = pattern.sub(" ", title)
    return title, removed


# ---------------------------------------------------------------------------
# Stage 3 — marketing words (skip safe words)
# ---------------------------------------------------------------------------

def _remove_marketing_words(title: str) -> Tuple[str, List[str]]:
    removed = []
    for pattern, word in _MARKETING_PATTERNS:
        if word.upper() in _SAFE_WORDS_UPPER:
            continue
        if pattern.search(title):
            removed.append(word.title())
            title = pattern.sub(" ", title)
    return title, removed


# ---------------------------------------------------------------------------
# Stage 4 — duplicate consecutive tokens
# ---------------------------------------------------------------------------

def _remove_duplicate_tokens(title: str) -> Tuple[str, List[str]]:
    """Remove runs of the same word appearing consecutively (case-insensitive)."""
    tokens = title.split()
    cleaned_tokens = []
    removed = []
    prev = None
    for token in tokens:
        if prev is not None and token.upper() == prev.upper():
            if token not in removed:
                removed.append(token)
        else:
            cleaned_tokens.append(token)
        prev = token
    return " ".join(cleaned_tokens), removed


# ---------------------------------------------------------------------------
# Stage 5 — vendor / SKU junk (only when token is isolated, not only token)
# ---------------------------------------------------------------------------

def _looks_like_vendor_junk(token: str) -> bool:
    for pattern in _VENDOR_COMPILED:
        if pattern.fullmatch(token):
            return True
    return False


def _remove_vendor_junk(title: str) -> Tuple[str, List[str]]:
    tokens = title.split()
    if len(tokens) <= 1:
        # Never remove the only token — preserve the original
        return title, []
    cleaned = []
    removed = []
    for token in tokens:
        if _looks_like_vendor_junk(token):
            removed.append(token)
        else:
            cleaned.append(token)
    # Safety: if we'd remove everything, keep original
    if not cleaned:
        return title, []
    return " ".join(cleaned), removed


# ---------------------------------------------------------------------------
# Stage 6 — separator cleanup
# ---------------------------------------------------------------------------

def _clean_separators(title: str) -> str:
    for sep in SEPARATOR_CHARS:
        title = title.replace(sep, " ")
    return title


# ---------------------------------------------------------------------------
# Stage 7 — postprocessing normalisation
# ---------------------------------------------------------------------------

def _normalise(title: str) -> str:
    # Collapse multiple spaces
    title = re.sub(r"\s{2,}", " ", title)
    # Remove leading/trailing whitespace and punctuation
    title = title.strip(" ,-|/\\")
    return title


# ---------------------------------------------------------------------------
# AI layer — borderline token classification
# ---------------------------------------------------------------------------

_openai_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None
        try:
            from openai import OpenAI
            _openai_client = OpenAI(api_key=api_key)
        except ImportError:
            return None
    return _openai_client


def _classify_borderline_tokens(title: str, candidates: List[str]) -> Tuple[List[str], bool]:
    """
    Ask OpenAI whether candidate tokens are safe to remove.
    Returns (safe_to_remove, contains_uncertainty).
    Falls back to keeping all tokens if AI is unavailable.
    """
    if not candidates:
        return [], False

    client = _get_openai_client()
    if client is None:
        # No AI available — keep everything, flag uncertainty
        return [], True

    token_list = ", ".join(f'"{t}"' for t in candidates)
    prompt = (
        f'You are reviewing tokens from this e-commerce product title:\n'
        f'"{title}"\n\n'
        f'Tokens to classify: {token_list}\n\n'
        f'For each token, decide: is it obvious noise (vendor code, junk) safe to remove '
        f'without changing the product meaning? Or is it a real part of the product identity '
        f'(brand, model, size, colour, etc.)?\n\n'
        f'Respond in JSON only, no prose. Example:\n'
        f'{{"results": [{{"token": "AB99XZ", "remove": true}}, {{"token": "18V", "remove": false}}]}}'
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        import json
        data = json.loads(response.choices[0].message.content)
        safe_to_remove = [
            r["token"] for r in data.get("results", []) if r.get("remove") is True
        ]
        return safe_to_remove, False
    except Exception:
        # Any AI error → keep tokens, flag uncertainty
        return [], True


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def clean_title(original: str) -> CleanResult:
    """
    Run the full cleaning pipeline on a single title.
    """
    if not original or not original.strip():
        return CleanResult(
            original_title=original,
            cleaned_title=original,
            noise_found=False,
            removed_tokens=[],
            noise_categories=[],
            confidence_score=100,
            contains_uncertainty=False,
        )

    working = original
    all_removed: List[str] = []
    categories: List[str] = []
    contains_uncertainty = False

    # --- Stage 1: symbol clutter ---
    working, sym_removed = _remove_symbol_clutter(working)
    if sym_removed:
        all_removed.extend(sym_removed)
        categories.append("symbol_clutter")

    # --- Stage 2: promo phrases ---
    working, promo_removed = _remove_promo_phrases(working)
    if promo_removed:
        all_removed.extend(promo_removed)
        categories.append("promo_noise")

    # --- Stage 3: marketing words ---
    working, mktg_removed = _remove_marketing_words(working)
    if mktg_removed:
        all_removed.extend(mktg_removed)
        categories.append("marketing_noise")

    # --- Stage 4: separator cleanup ---
    working = _clean_separators(working)

    # --- Stage 5: duplicate tokens ---
    working, dup_removed = _remove_duplicate_tokens(working)
    if dup_removed:
        all_removed.extend(dup_removed)
        categories.append("duplicate_tokens")

    # --- Stage 6: vendor junk (deterministic pass) ---
    working, vendor_removed = _remove_vendor_junk(working)
    if vendor_removed:
        all_removed.extend(vendor_removed)
        categories.append("vendor_junk")

    # --- Stage 7: AI pass for remaining suspicious tokens ---
    # Identify tokens that look borderline (all-caps, short, alphanumeric)
    remaining_tokens = working.split()
    borderline = [
        t for t in remaining_tokens
        if re.fullmatch(r"[A-Z0-9]{3,7}", t)
        and t not in _SAFE_WORDS_UPPER
        # Only flag if there are enough other tokens to survive removal
        and len(remaining_tokens) > 2
    ]
    if borderline:
        ai_removed, uncertainty = _classify_borderline_tokens(working, borderline)
        contains_uncertainty = uncertainty
        if ai_removed:
            for token in ai_removed:
                pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(token) + r"(?![A-Za-z0-9])", re.IGNORECASE)
                working = pat.sub(" ", working)
            all_removed.extend(ai_removed)
            if "vendor_junk" not in categories:
                categories.append("vendor_junk")

    # --- Stage 8: final normalisation ---
    working = _normalise(working)

    # Safety: never return an empty cleaned title
    if not working.strip():
        working = original.strip()
        all_removed = []
        categories = []
        contains_uncertainty = True

    noise_found = len(all_removed) > 0

    # Confidence: start at 100, penalise for uncertainty or many removals
    confidence = 100
    if contains_uncertainty:
        confidence -= 15
    confidence -= min(len(all_removed) * 2, 20)
    confidence = max(confidence, 0)

    return CleanResult(
        original_title=original,
        cleaned_title=working,
        noise_found=noise_found,
        removed_tokens=all_removed,
        noise_categories=list(dict.fromkeys(categories)),  # deduplicated, ordered
        confidence_score=confidence,
        contains_uncertainty=contains_uncertainty,
    )
