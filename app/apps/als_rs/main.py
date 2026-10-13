from app.libs.te2_asgi.status import StatusASGI

# Compatibility wrapper only: the shellspec launches the actual Rust ALS server.
TE2_ASGI_APP = StatusASGI("ALS-RS backend ready")
