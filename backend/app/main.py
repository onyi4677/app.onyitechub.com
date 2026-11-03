
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.api.integrity_routes import router as integrity_router
from app.services.integrity_submissions import cleanup_expired_submissions
from mangum import Mangum

app = FastAPI(
    title="Onyitech Research Workspace API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://app.onyitechub.com",
        "https://app-onyitechub-ywwi09o3t-onyitechub.vercel.app",
        "https://app-onyitechub-358h7j9c1-onyitechub.vercel.app",
        "https://app-onyitechub-m3au06wu5-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feature-prevent-litera-fa3c62-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feature-study-screenin-98b495-onyitechub.vercel.app",
        "https://app-onyitechub-l25wvbrhz-onyitechub.vercel.app",
        "https://app-onyitechub-ihgt60tmp-onyitechub.vercel.app",
        "https://app-onyitechub-ko42m4rd5-onyitechub.vercel.app",
        "https://app-onyitechub-3f1jipt6s-onyitechub.vercel.app",
        "https://app-onyitechub-k2adn6n2a-onyitechub.vercel.app",
        "https://app-onyitechub-6acf3n567-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feature-instruments-de-b4bd26-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-fix-methodology-screen-586e55-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feat-research-lifecycl-166406-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feat-screening-12-module-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feature-instruments-da-03fe60-onyitechub.vercel.app",
    ],
    allow_origin_regex=r"https://app-onyitechub-[a-z0-9-]+-onyitechub\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(integrity_router)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "onyitech-research-api",
        "status": "running",
    }


api_handler = Mangum(app)


def handler(event, context):
    """Dispatch scheduled retention cleanup events; send all other events to FastAPI."""
    if (
        isinstance(event, dict)
        and event.get("source") == "aws.events"
        and event.get("detail", {}).get("task") == "integrity-retention-cleanup"
    ):
        return cleanup_expired_submissions()
    return api_handler(event, context)
