from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..events import get_event_bus

router = APIRouter()

@router.websocket("/ws/events")
async def shell_events_ws(websocket: WebSocket):
    """Stream all shell lifecycle events."""
    await websocket.accept()
    bus = get_event_bus()
    q = bus.subscribe()
    
    try:
        while True:
            event = await q.get()
            await websocket.send_json(event.to_dict())
    except WebSocketDisconnect:
        pass
    except Exception:
        # Prevent loop exit on transient transform errors, or exit cleanly
        pass
    finally:
        bus.unsubscribe(q)
