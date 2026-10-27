"""Centralised error type. Messages are safe to show to end users."""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class ConversionError(ApiError):
    """The file was accepted but could not be converted (corrupt, unsupported content...)."""

    def __init__(self, message: str, code: str = "conversion_failed", status: int = 422):
        super().__init__(status, code, message)


def bad_request(message: str, code: str = "bad_request") -> ApiError:
    return ApiError(400, code, message)
