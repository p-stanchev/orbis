from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections.add(websocket)
        await self.broadcast_users()

    async def disconnect(self, websocket: WebSocket):
        self.connections.discard(websocket)
        await self.broadcast_users()

    async def broadcast_users(self):
        await self.broadcast("users_changed", {
            "count": len(self.connections)
        })

    async def broadcast(self, event_type: str, data=None):
        for connection in tuple(self.connections):
            try:
                await connection.send_json({
                    "type": event_type,
                    "data": data
                })
            except Exception:
                self.connections.discard(connection)


manager = ConnectionManager()