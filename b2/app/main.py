from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.apis import auth as auth_router
from app.apis import messaging as messaging_router
from app.apis import users as users_router

app = FastAPI(title="Silent Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/auth", tags=["Authentication"])
app.include_router(messaging_router.router)
app.include_router(users_router.router) # Include the new users router

@app.get("/", tags=["Health Check"])
def read_root():
    """A simple health check endpoint."""
    return {"status": "ok"}
