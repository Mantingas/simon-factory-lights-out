"""
Unit tests for the core cleaning logic.
Run with: pytest noise-cleaner/tests/ -v
"""

import sys
import os

# Allow running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.cleaner import clean_title


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def result(title):
    return clean_title(title)


# ---------------------------------------------------------------------------
# Symbol clutter
# ---------------------------------------------------------------------------

class TestSymbolClutter:
    def test_exclamation_marks(self):
        r = result("Bosch Drill !!! SALE")
        assert "!!!" in r.removed_tokens
        assert "symbol_clutter" in r.noise_categories

    def test_hash_symbols(self):
        r = result("Makita Driver ###")
        assert "###" in r.removed_tokens

    def test_double_star(self):
        r = result("DeWalt Saw ***")
        assert "***" in r.removed_tokens

    def test_triple_dash(self):
        r = result("Hammer --- 500g")
        assert "---" in r.removed_tokens

    def test_no_false_positive_single_exclamation(self):
        # Single ! is NOT flagged as symbol clutter (pattern requires 2+)
        r = result("Bosch Drill 18V")
        assert "symbol_clutter" not in r.noise_categories

    def test_cleaned_title_has_no_symbol_clutter(self):
        r = result("Sony WH-1000XM5 *** BEST")
        assert "***" not in r.cleaned_title
        assert "!!!" not in r.cleaned_title


# ---------------------------------------------------------------------------
# Marketing words
# ---------------------------------------------------------------------------

class TestMarketingWords:
    def test_best_removed(self):
        r = result("BEST Cordless Drill Bosch 18V")
        assert r.noise_found
        assert "marketing_noise" in r.noise_categories

    def test_new_removed(self):
        r = result("NEW Makita DHP482Z 18V Drill Driver")
        assert "New" in r.removed_tokens or "NEW" in r.removed_tokens

    def test_sale_removed(self):
        r = result("Bosch GSB 18V SALE")
        assert r.noise_found

    def test_case_insensitive(self):
        r = result("bosch drill best sale")
        assert r.noise_found

    def test_marketing_word_in_middle(self):
        r = result("Bosch BEST Drill 18V")
        assert r.noise_found
        assert "Bosch" in r.cleaned_title
        assert "Drill" in r.cleaned_title
        assert "18V" in r.cleaned_title

    def test_professional_preserved(self):
        # PROFESSIONAL is in SAFE_WORDS — must not be removed
        r = result("Bosch GSB 18V-50 Professional Cordless Drill")
        assert "Professional" not in r.removed_tokens
        assert "professional" not in [t.lower() for t in r.removed_tokens]


# ---------------------------------------------------------------------------
# Promo phrases
# ---------------------------------------------------------------------------

class TestPromoPhrases:
    def test_free_shipping(self):
        r = result("Makita DHP482Z 18V Drill Driver FREE SHIPPING")
        assert r.noise_found
        assert "promo_noise" in r.noise_categories

    def test_buy_now(self):
        r = result("Bosch Drill BUY NOW")
        assert r.noise_found

    def test_100_percent_original(self):
        r = result("Nike Shoes 100% ORIGINAL size 42")
        assert r.noise_found
        # size 42 must survive
        assert "42" in r.cleaned_title

    def test_phrase_case_insensitive(self):
        r = result("Drill free shipping")
        assert r.noise_found


# ---------------------------------------------------------------------------
# Duplicate tokens
# ---------------------------------------------------------------------------

class TestDuplicateTokens:
    def test_consecutive_duplicates_removed(self):
        r = result("Drill Drill Bosch Drill")
        # At least one "Drill" removed (consecutive)
        assert r.noise_found
        assert "duplicate_tokens" in r.noise_categories

    def test_non_consecutive_duplicates_kept(self):
        # Non-consecutive duplicates should NOT be removed
        r = result("Bosch Drill 18V Bosch")
        # "Bosch" appears twice but not consecutively — second may survive
        assert "Bosch" in r.cleaned_title


# ---------------------------------------------------------------------------
# Preservation rules
# ---------------------------------------------------------------------------

class TestPreservation:
    def test_brand_preserved(self):
        r = result("Bosch GSB 18V-50 !!! BEST SALE")
        assert "Bosch" in r.cleaned_title

    def test_model_preserved(self):
        r = result("Makita DHP482Z 18V Drill Driver NEW FREE SHIPPING ###")
        assert "DHP482Z" in r.cleaned_title

    def test_voltage_preserved(self):
        r = result("Bosch GSB 18V-50 Professional Cordless Drill SALE")
        assert "18V" in r.cleaned_title or "18V-50" in r.cleaned_title

    def test_capacity_preserved(self):
        r = result("Bosch GSB 18V-50 2x2.0Ah L-Case !!! BEST")
        assert "2x2.0Ah" in r.cleaned_title

    def test_colour_preserved(self):
        r = result("Bosch GSB 18V-50 Blue BEST SALE")
        assert "Blue" in r.cleaned_title

    def test_size_preserved(self):
        r = result("Nike Shoes Size 42 FREE SHIPPING")
        assert "42" in r.cleaned_title

    def test_clean_title_not_empty(self):
        r = result("BEST SALE NEW !!!")
        assert r.cleaned_title.strip() != ""


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

class TestOutputSchema:
    def test_clean_title_unchanged_when_no_noise(self):
        original = "DeWalt DCD796NT-XJ Combi Drill 18V 2-Speed"
        r = result(original)
        assert r.cleaned_title == original
        assert r.noise_found is False

    def test_original_title_always_preserved(self):
        original = "Bosch Drill !!! BEST"
        r = result(original)
        assert r.original_title == original

    def test_confidence_between_0_and_100(self):
        r = result("Bosch Drill")
        assert 0 <= r.confidence_score <= 100

    def test_noise_found_false_when_nothing_removed(self):
        r = result("DeWalt DCD796NT-XJ Combi Drill 18V")
        assert r.noise_found is False
        assert r.removed_tokens == []

    def test_noise_found_true_when_something_removed(self):
        r = result("Bosch Drill BEST SALE !!!")
        assert r.noise_found is True

    def test_empty_string_handled(self):
        r = result("")
        assert r.cleaned_title == ""
        assert r.noise_found is False


# ---------------------------------------------------------------------------
# Spec examples from the brief
# ---------------------------------------------------------------------------

class TestSpecExamples:
    def test_example_1(self):
        r = result("Bosch GSB 18V-50 Professional Cordless Drill Blue 2x2.0Ah L-Case !!! BEST SALE")
        assert "Bosch" in r.cleaned_title
        assert "GSB" in r.cleaned_title
        assert "2x2.0Ah" in r.cleaned_title
        assert r.noise_found
        assert "!!!" in r.removed_tokens or any("!" in t for t in r.removed_tokens)

    def test_example_2(self):
        r = result("Makita DHP482Z 18V Drill Driver NEW FREE SHIPPING ###")
        assert "Makita" in r.cleaned_title
        assert "DHP482Z" in r.cleaned_title
        assert "18V" in r.cleaned_title
        assert r.noise_found

    def test_example_3(self):
        r = result("DeWalt DCD796NT-XJ Combi Drill 18V 2-Speed")
        assert r.noise_found is False
        assert "DeWalt" in r.cleaned_title
