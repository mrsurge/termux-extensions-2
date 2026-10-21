"""Typed ingress for the retained Python HTTP resource adapters."""
from starlette.exceptions import HTTPException
from starlette.requests import Request


def path_parameter(request: Request, name: str) -> str:
    # Starlette's path-parameter map is heterogeneous. These resource routes all
    # declare string/path converters; validate at that boundary, not by casting.
    parameters: dict[str, object] = request.path_params
    value = parameters.get(name)
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"Invalid path parameter: {name}")
    return value
