from typing import List, Optional
from pydantic import BaseModel, field_validator


class CleanRequest(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must not be empty")
        return v


class CleanResult(BaseModel):
    original_title: str
    cleaned_title: str
    noise_found: bool
    removed_tokens: List[str]
    noise_categories: List[str]
    confidence_score: int          # 0–100
    contains_uncertainty: bool


class BulkCleanResponse(BaseModel):
    results: List[CleanResult]
    total: int
    noise_found_count: int
