"""ASGI entry point: `uvicorn asgi:app` (run from the backend/ directory)."""
from app.main import create_app

app = create_app()
