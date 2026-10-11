"""Isolated two-write/one-reply TCP probe for the proxy's Nagle hypothesis.

This is a TCP mechanism test, not a replacement for a live framework A/B.
"""
import asyncio
import json
import socket
import statistics
import time


async def echo(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            await reader.readexactly(101)
            writer.write(b'ok')
            await writer.drain()
    except asyncio.IncompleteReadError:
        pass
    finally:
        writer.close()
        await writer.wait_closed()


async def main() -> None:
    server = await asyncio.start_server(echo, '127.0.0.1', 0)
    port = server.sockets[0].getsockname()[1]
    results = []
    try:
        for nodelay in (False, True):
            reader, writer = await asyncio.open_connection('127.0.0.1', port)
            writer.get_extra_info('socket').setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, int(nodelay))
            values = []
            try:
                for index in range(35):
                    start = time.perf_counter()
                    writer.write(b'h')
                    await writer.drain()
                    writer.write(b'x' * 100)
                    await writer.drain()
                    await asyncio.wait_for(reader.readexactly(2), 2)
                    if index >= 5:
                        values.append((time.perf_counter() - start) * 1000)
                    await asyncio.sleep(.005)
            finally:
                writer.close()
                await writer.wait_closed()
            results.append({'tcpNoDelay': nodelay, 'n': len(values),
                            'p50Ms': round(statistics.median(values), 3),
                            'p95Ms': round(sorted(values)[28], 3)})
    finally:
        server.close()
        await server.wait_closed()
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
