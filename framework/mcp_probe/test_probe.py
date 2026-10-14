"""Real loopback protocol qualification, never calls production TE2 tools."""
from __future__ import annotations
import asyncio
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import unittest

import httpx

ROOT = Path(__file__).resolve().parents[2]
BINARY = Path(os.environ.get('TE2_MCP_PROBE_BIN', str(ROOT / 'framework/rust/target/debug/te2-mcp-probe')))
VERSION = '2025-11-25'


def rpc_body(response: httpx.Response) -> dict[str, object]:
    # Streamable HTTP may use SSE even when plain JSON is preferred.
    if 'text/event-stream' not in response.headers.get('content-type', ''):
        return response.json()
    for event in response.text.replace('\r\n', '\n').split('\n\n'):
        data = '\n'.join(line[5:].lstrip() for line in event.splitlines() if line.startswith('data:'))
        if data:
            payload = json.loads(data)
            if isinstance(payload, dict) and 'id' in payload:
                return payload
    raise AssertionError(f'No JSON-RPC response in SSE body: {response.text!r}')


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.process = subprocess.Popen([str(BINARY)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        if cls.process.stdout is None or not select.select([cls.process.stdout], [], [], 15)[0]:
            cls.process.kill()
            cls.process.wait()
            raise RuntimeError('probe did not report loopback listener')
        address = cls.process.stdout.readline().strip()
        if not address.startswith('127.0.0.1:'):
            cls.process.kill()
            cls.process.wait()
            raise RuntimeError(f'invalid loopback address: {address}')
        cls.url = f'http://{address}/mcp'

    @classmethod
    def tearDownClass(cls) -> None:
        cls.process.send_signal(signal.SIGINT)
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()
        if cls.process.stdout is not None:
            cls.process.stdout.close()

    async def asyncSetUp(self) -> None:
        self.client = httpx.AsyncClient(timeout=7)
        self.headers = {'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': VERSION}
        response = await self.client.post(self.url, headers=self.headers, json={
            'jsonrpc':'2.0', 'id':1, 'method':'initialize', 'params':{
                'protocolVersion': VERSION, 'capabilities':{},
                'clientInfo':{'name':'te2-isolated-probe', 'version':'1'}}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(rpc_body(response)['result']['protocolVersion'], VERSION)
        self.session = response.headers['mcp-session-id']
        self.headers['Mcp-Session-Id'] = self.session
        response = await self.client.post(self.url, headers=self.headers,
            json={'jsonrpc':'2.0', 'method':'notifications/initialized'})
        self.assertEqual(response.status_code, 202, response.text)

    async def asyncTearDown(self) -> None:
        await self.client.delete(self.url, headers=self.headers)
        await self.client.aclose()

    async def rpc(self, method: str, params: dict[str, object] | None = None, identifier: int = 2) -> dict[str, object]:
        response = await self.client.post(self.url, headers=self.headers,
            json={'jsonrpc':'2.0', 'id':identifier, 'method':method, 'params':params or {}})
        self.assertEqual(response.status_code, 200, response.text)
        return rpc_body(response)

    async def test_tool_catalog_and_nested_echo(self) -> None:
        result = await self.rpc('tools/list')
        tools = result['result']['tools']
        self.assertEqual({tool['name'] for tool in tools}, {'probe_echo','probe_count','probe_wait','probe_active_waits'})
        echo = next(tool for tool in tools if tool['name'] == 'probe_echo')
        self.assertEqual(echo['inputSchema']['required'], ['value'])
        value = {'nested':[1, None, 'héllo', {'enabled':True}]}
        result = await self.rpc('tools/call', {'name':'probe_echo', 'arguments':{'value':value}})
        self.assertEqual(json.loads(result['result']['content'][0]['text']), value)

    async def test_schema_and_tool_errors(self) -> None:
        missing = await self.rpc('tools/call', {'name':'probe_echo', 'arguments':{}})
        self.assertTrue('error' in missing or missing.get('result', {}).get('isError'))
        unknown = await self.rpc('tools/call', {'name':'does_not_exist'})
        self.assertTrue('error' in unknown or unknown.get('result', {}).get('isError'))
        bounded = await self.rpc('tools/call', {'name':'probe_wait', 'arguments':{'milliseconds':5001}})
        self.assertTrue(bounded['result']['isError'])

    async def test_sessions_are_isolated_and_deleted(self) -> None:
        first = await self.rpc('tools/call', {'name':'probe_count'})
        self.assertEqual(first['result']['content'][0]['text'], '1')
        second = await self.rpc('tools/call', {'name':'probe_count'})
        self.assertEqual(second['result']['content'][0]['text'], '2')
        response = await self.client.delete(self.url, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        response = await self.client.post(self.url, headers=self.headers,
            json={'jsonrpc':'2.0','id':3,'method':'tools/list'})
        self.assertEqual(response.status_code, 404)
        # A new initialization creates independent handler state.
        headers = {key:value for key,value in self.headers.items() if key != 'Mcp-Session-Id'}
        response = await self.client.post(self.url, headers=headers, json={
            'jsonrpc':'2.0','id':1,'method':'initialize','params':{
            'protocolVersion':VERSION,'capabilities':{},'clientInfo':{'name':'second','version':'1'}}})
        new_session = response.headers['mcp-session-id']
        self.assertNotEqual(new_session, self.session)
        self.headers['Mcp-Session-Id'] = new_session
        await self.client.post(self.url, headers=self.headers, json={'jsonrpc':'2.0','method':'notifications/initialized'})
        result = await self.rpc('tools/call', {'name':'probe_count'})
        self.assertEqual(result['result']['content'][0]['text'], '1')

    async def test_cancellation_preserves_session(self) -> None:
        wait = asyncio.create_task(self.client.post(self.url, headers=self.headers, json={
            'jsonrpc':'2.0','id':77,'method':'tools/call',
            'params':{'name':'probe_wait','arguments':{'milliseconds':5000}}}))
        await asyncio.sleep(0.1)
        active = await self.rpc('tools/call', {'name':'probe_active_waits'})
        self.assertEqual(active['result']['content'][0]['text'], '1')
        response = await self.client.post(self.url, headers=self.headers, json={
            'jsonrpc':'2.0','method':'notifications/cancelled','params':{'requestId':77,'reason':'probe'}})
        self.assertEqual(response.status_code, 202)
        try:
            response = await asyncio.wait_for(wait, timeout=2)
            self.assertEqual(response.status_code, 200)
            # Cancelled requests may close without a JSON-RPC result.
            self.assertNotIn('completed', response.text)
        finally:
            if not wait.done():
                wait.cancel()
                await asyncio.gather(wait, return_exceptions=True)
        result = await self.rpc('tools/call', {'name':'probe_count'})
        self.assertEqual(result['result']['content'][0]['text'], '1')
        active = await self.rpc('tools/call', {'name':'probe_active_waits'})
        self.assertEqual(active['result']['content'][0]['text'], '0')

    async def test_sse_response_channel_and_disconnect(self) -> None:
        async with self.client.stream('GET', self.url, headers=self.headers) as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn('text/event-stream', response.headers['content-type'])
        result = await self.rpc('tools/list')
        self.assertIn('result', result)

    async def test_real_python_sdk_client(self) -> None:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        async with streamable_http_client(self.url) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                self.assertEqual(len(tools.tools), 4)
                result = await session.call_tool('probe_echo', {'value':'sdk proof'})
                self.assertFalse(result.isError)

    async def test_ingress_bounds_and_unknown_session(self) -> None:
        headers = {**self.headers, 'Content-Type':'application/json'}
        response = await self.client.post(self.url, headers=headers, content=b'x' * (64 * 1024 + 1))
        self.assertEqual(response.status_code, 413)
        response = await self.client.post(self.url, headers=headers, content=b'{')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {'jsonrpc':'2.0','id':None,'error':{'code':-32700,'message':'Parse error'}})
        response = await self.client.post(self.url, headers={**self.headers,'Mcp-Session-Id':'invalid'},
            json={'jsonrpc':'2.0','id':2,'method':'tools/list'})
        self.assertEqual(response.status_code, 404)


    async def test_compatibility_leaves_real_media_errors_and_notifications_alone(self) -> None:
        response = await self.client.post(self.url, headers={**self.headers,'Content-Type':'text/plain'}, content=b'{')
        self.assertEqual(response.status_code, 415)
        response = await self.client.post(self.url, headers=self.headers, json={'jsonrpc':'2.0','method':'notifications/initialized'})
        self.assertEqual(response.status_code, 202)
        response = await self.client.delete(self.url, headers={key:value for key,value in self.headers.items() if key != 'Mcp-Session-Id'})
        self.assertEqual(response.status_code, 400)
        first = await self.rpc('tools/call', {'name':'probe_count'})
        self.assertEqual(first['result']['content'][0]['text'], '1')


if __name__ == '__main__':
    unittest.main()
