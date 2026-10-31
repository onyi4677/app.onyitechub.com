
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
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
        "https://app-onyitechub-3vxwlzaut-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-fix-methodology-screen-586e55-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feat-research-lifecycl-166406-onyitechub.vercel.app",
        "https://app-onyitechub-com-git-feat-screening-12-module-onyitechub.vercel.app",
    ],
    allow_origin_regex=r"https://app-onyitechub-[a-z0-9-]+-onyitechub\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "onyitech-research-api",
        "status": "running",
    }


handler = Mangum(app)
